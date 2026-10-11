// Bristol EPS — rappel quotidien par notification (Web Push : RFC 8030, 8291, 8292).
//
// - Le navigateur s'abonne auprès de son service de push (Google, Mozilla, Apple…) avec
//   la clé publique VAPID du site, puis envoie l'abonnement ici (compte requis).
// - Toutes les 15 minutes, le Worker (cron) envoie le rappel aux abonnés dont l'heure
//   est passée, une fois par jour, et seulement si la personne n'a pas encore révisé.
// - Les clés VAPID sont créées au premier besoin et gardées dans D1 (table config) :
//   aucun secret à régler, rien dans le dépôt.
// - Le contenu est chiffré pour le navigateur (aes128gcm) : le service de push ne le lit pas.
import { json, err, readJson, currentUser } from "./account.js";

const te = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const ub64 = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(s).length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const concat = (...a) => { const o = new Uint8Array(a.reduce((t, x) => t + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

const MAX_SUBS_PER_USER = 10;
const HM = /^([01]\d|2[0-3]):(00|15|30|45)$/;
// Services de push des navigateurs : on n'envoie jamais ailleurs.
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)$/;

let ready = false;
async function ensurePush(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, hm TEXT NOT NULL, origin TEXT NOT NULL, last_day TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs(user_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT NOT NULL)"),
  ]);
  ready = true;
}

let vapid = null;
async function getVapid(env) {
  if (vapid) return vapid;
  await ensurePush(env);
  let row = await env.DB.prepare("SELECT v FROM config WHERE k = 'vapid'").first();
  if (!row) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
    const pub = b64u(await crypto.subtle.exportKey("raw", kp.publicKey));
    // INSERT OR IGNORE puis relecture : deux instances simultanées gardent la même clé.
    await env.DB.prepare("INSERT OR IGNORE INTO config (k, v) VALUES ('vapid', ?)").bind(JSON.stringify({ jwk, pub })).run();
    row = await env.DB.prepare("SELECT v FROM config WHERE k = 'vapid'").first();
  }
  const { jwk, pub } = JSON.parse(row.v);
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  vapid = { key, pub };
  return vapid;
}

async function vapidHeader(env, endpoint, subject) {
  const { key, pub } = await getVapid(env);
  const h = b64u(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const c = b64u(te.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(h + "." + c));
  return `vapid t=${h}.${c}.${b64u(sig)}, k=${pub}`;
}

// Chiffrement aes128gcm du message pour le navigateur (RFC 8291).
export async function encryptPush(text, p256dh, auth) {
  const ua = ub64(p256dh), secret = ub64(auth);
  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, eph.privateKey, 256));
  const hkdf = async (ikm, salt, info, bits) => new Uint8Array(await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), bits));
  const ikm = await hkdf(shared, secret, concat(te.encode("WebPush: info\0"), ua, asPub), 256);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(ikm, salt, te.encode("Content-Encoding: aes128gcm\0"), 128);
  const nonce = await hkdf(ikm, salt, te.encode("Content-Encoding: nonce\0"), 96);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(te.encode(text), new Uint8Array([2]))));
  return concat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([asPub.length]), asPub, ct);
}

async function sendPush(env, sub, message) {
  const body = await encryptPush(JSON.stringify(message), sub.p256dh, sub.auth);
  let res;
  try {
    res = await fetch(sub.endpoint, {
      method: "POST",
      headers: { authorization: await vapidHeader(env, sub.endpoint, sub.origin), "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "43200", urgency: "normal" },
      body,
    });
  } catch (e) { return 0; }
  // Abonnement expiré ou retiré : on l'oublie.
  if (res.status === 404 || res.status === 410) await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(sub.endpoint).run();
  return res.status;
}

function parisNow(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${String(Math.floor(+p.minute / 15) * 15).padStart(2, "0")}` };
}

// Message du jour d'après la progression synchronisée ; null si la personne a déjà révisé.
export function dailyMessage(data, day, now = Date.now()) {
  const d = data || {};
  if (((d.log || {})[day] || {}).a > 0) return null;
  const due = Object.values(d.progress || {}).filter((p) => p && p.d && p.d <= now).length;
  return {
    title: "Bristol EPS",
    body: due ? `${due} carte${due > 1 ? "s" : ""} à revoir aujourd'hui. Dix minutes suffisent pour garder le rythme.` : "Ta séance du jour t'attend : quelques nouvelles cartes pour avancer.",
    url: "/?depuis=rappel", tag: "bristol-rappel",
  };
}

export async function runDaily(env, now = new Date()) {
  if (!env.DB) return { sent: 0 };
  await ensurePush(env);
  const { day, hm } = parisNow(now);
  const { results } = await env.DB.prepare(
    "SELECT s.endpoint, s.user_id, s.p256dh, s.auth, s.origin, p.data FROM push_subs s LEFT JOIN progress p ON p.user_id = s.user_id WHERE s.hm <= ? AND s.last_day < ? LIMIT 200"
  ).bind(hm, day).all();
  let sent = 0;
  for (const s of results || []) {
    await env.DB.prepare("UPDATE push_subs SET last_day = ? WHERE endpoint = ?").bind(day, s.endpoint).run();
    let data = null; try { data = s.data ? JSON.parse(s.data) : null; } catch (e) {}
    const msg = dailyMessage(data, day, now.getTime());
    if (!msg) continue;
    const st = await sendPush(env, s, msg);
    if (st >= 200 && st < 300) sent++;
    else if (st !== 404 && st !== 410) console.error("Push refusé :", st, new URL(s.endpoint).host);
  }
  return { sent };
}

async function pushKey(request, env) {
  const { pub } = await getVapid(env);
  return json(200, { key: pub });
}

async function subscribe(request, env) {
  const { body, error } = await readJson(request); if (error) return error;
  const user = await currentUser(request, env);
  if (!user) return err(401, "not_signed_in");
  const endpoint = body && typeof body.endpoint === "string" ? body.endpoint : "";
  const keys = (body && body.keys) || {};
  let host = ""; try { const u = new URL(endpoint); if (u.protocol === "https:") host = u.hostname; } catch (e) {}
  if (!host || !PUSH_HOSTS.test(host) || endpoint.length > 1000) return err(400, "bad_endpoint");
  if (typeof keys.p256dh !== "string" || typeof keys.auth !== "string" || ub64(keys.p256dh).length !== 65 || ub64(keys.auth).length !== 16) return err(400, "bad_keys");
  const hm = typeof body.hm === "string" && HM.test(body.hm) ? body.hm : "";
  if (!hm) return err(400, "bad_time");
  await ensurePush(env);
  // Heure déjà passée aujourd'hui : premier rappel demain.
  const now = parisNow();
  const lastDay = hm <= now.hm ? now.day : "";
  await env.DB.prepare(
    "INSERT INTO push_subs (endpoint, user_id, p256dh, auth, hm, origin, last_day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, hm = excluded.hm, origin = excluded.origin, last_day = excluded.last_day"
  ).bind(endpoint, user.id, keys.p256dh, keys.auth, hm, new URL(request.url).origin, lastDay, Date.now()).run();
  await env.DB.prepare(
    "DELETE FROM push_subs WHERE user_id = ? AND endpoint NOT IN (SELECT endpoint FROM push_subs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)"
  ).bind(user.id, user.id, MAX_SUBS_PER_USER).run();
  return json(200, { ok: true, hm });
}

async function unsubscribe(request, env) {
  const { body, error } = await readJson(request); if (error) return error;
  const user = await currentUser(request, env);
  if (!user) return err(401, "not_signed_in");
  await ensurePush(env);
  await env.DB.prepare("DELETE FROM push_subs WHERE user_id = ? AND endpoint = ?").bind(user.id, String((body && body.endpoint) || "")).run();
  return json(200, { ok: true });
}

async function test(request, env) {
  const { body, error } = await readJson(request); if (error) return error;
  const user = await currentUser(request, env);
  if (!user) return err(401, "not_signed_in");
  await ensurePush(env);
  const row = await env.DB.prepare("SELECT endpoint, p256dh, auth, origin FROM push_subs WHERE user_id = ? AND endpoint = ?").bind(user.id, String((body && body.endpoint) || "")).first();
  if (!row) return err(404, "not_subscribed");
  const st = await sendPush(env, row, { title: "Bristol EPS", body: "Les rappels fonctionnent : tu recevras le prochain à l'heure choisie.", url: "/", tag: "bristol-test" });
  return st >= 200 && st < 300 ? json(200, { ok: true }) : err(502, "push_failed", { status: st });
}

const ROUTES = {
  "GET /api/push/key": pushKey,
  "POST /api/push/subscribe": subscribe,
  "POST /api/push/unsubscribe": unsubscribe,
  "POST /api/push/test": test,
};
export const isPushRoute = (pathname) => pathname.startsWith("/api/push/");
export async function handlePush(request, env) {
  if (!env.DB) return err(500, "accounts_not_configured");
  const fn = ROUTES[`${request.method} ${new URL(request.url).pathname}`];
  if (!fn) return err(404, "not_found");
  try { return await fn(request, env); }
  catch (e) { console.error("Erreur push :", String(e && e.stack || e)); return err(500, "server_error"); }
}

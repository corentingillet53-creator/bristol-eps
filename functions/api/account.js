// Bristol EPS — comptes utilisateurs et progression synchronisée.
//
// Sécurité :
// - le mot de passe ne quitte jamais le navigateur : celui-ci en dérive une clé
//   (PBKDF2-SHA256, 310 000 itérations, sel = e-mail) ; le serveur n'en stocke
//   qu'une empreinte SHA-256 salée (sel aléatoire par compte) ;
// - une clé de secours aléatoire, montrée une seule fois, permet de changer de
//   mot de passe ; seule son empreinte est stockée ;
// - la session est un jeton aléatoire dans un cookie HttpOnly, Secure, SameSite=Lax ;
//   seule son empreinte est stockée ;
// - les écritures exigent un corps JSON et, si le navigateur l'envoie, une origine
//   identique au site (protection CSRF) ;
// - les tentatives de connexion et de récupération sont limitées par e-mail.
//
// - connexion avec Google (OpenID Connect, code d'autorisation + PKCE) : le jeton
//   d'identité est obtenu directement auprès de Google avec le secret client, puis
//   ses champs (aud, iss, exp, email_verified) sont vérifiés ; un compte existant
//   avec la même adresse est relié automatiquement.
//
// - les textes rédigés (copies, introductions, retours de Claude) sont stockés à part,
//   une ligne par texte (table texts), fusionnés au plus récent par clé.
//
// Liaisons : DB (D1, obligatoire), QUOTA (KV, pour limiter les tentatives).
// Variables Google : GOOGLE_CLIENT_ID (texte), GOOGLE_CLIENT_SECRET (secret).

const SESSION_COOKIE = "bsess";
const SESSION_DAYS = 60;
const MAX_PROGRESS_BYTES = 256 * 1024;
const MAX_ATTEMPTS_PER_HOUR = 10;
const MAX_TEXT_CHARS = 80000;          // une copie de 6 h tient largement
const MAX_TEXT_ITEMS = 40;             // textes par envoi
const MAX_TEXTS_PER_USER = 3000;
const MAX_TEXTS_BODY = 2 * 1024 * 1024;
const TEXT_KEY = /^[A-Za-z0-9:_.-]{1,80}$/;
const enc = new TextEncoder();

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}
const err = (status, error, extra = {}) => json(status, { error, ...extra });

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function sha256Hex(...parts) {
  const chunks = parts.map((p) => (typeof p === "string" ? enc.encode(p) : p));
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  return hex(await crypto.subtle.digest("SHA-256", all));
}
function randomHex(bytes) { return hex(crypto.getRandomValues(new Uint8Array(bytes))); }
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Clé de secours lisible : 5 groupes de 5 caractères sans ambiguïté (≈ 120 bits).
const RC_ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newRecoveryKey() {
  const b = crypto.getRandomValues(new Uint8Array(25));
  const s = [...b].map((x) => RC_ALPHA[x % 32]).join("");
  return s.match(/.{5}/g).join("-");
}
const normRecovery = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const normEmail = (s) => String(s || "").trim().toLowerCase();
const validEmail = (s) => s.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
// La clé dérivée arrive en hexadécimal (32 octets = 64 caractères).
const validKey = (k) => typeof k === "string" && /^[0-9a-f]{64}$/.test(k);

function getCookie(request, name) {
  const h = request.headers.get("cookie") || "";
  for (const part of h.split(/;\s*/)) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1); }
  return "";
}
function sessionCookie(token, maxAge) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function readJson(request) {
  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return { error: err(415, "json_required") };
  const origin = request.headers.get("origin");
  if (origin) {
    try { if (new URL(origin).host !== new URL(request.url).host) return { error: err(403, "bad_origin") }; }
    catch { return { error: err(403, "bad_origin") }; }
  }
  try { return { body: await request.json() }; } catch { return { error: err(400, "bad_request") }; }
}

async function tooManyAttempts(env, kind, email) {
  if (!env.QUOTA) return false;
  const k = `rl:${kind}:${email}:${new Date().toISOString().slice(0, 13)}`;
  return (parseInt((await env.QUOTA.get(k)) || "0", 10) || 0) >= MAX_ATTEMPTS_PER_HOUR;
}
async function countAttempt(env, kind, email) {
  if (!env.QUOTA) return;
  const k = `rl:${kind}:${email}:${new Date().toISOString().slice(0, 13)}`;
  const n = (parseInt((await env.QUOTA.get(k)) || "0", 10) || 0) + 1;
  await env.QUOTA.put(k, String(n), { expirationTtl: 60 * 60 * 2 });
}

async function createSession(env, userId) {
  const token = randomHex(32);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), userId, now, now + SESSION_DAYS * 86400000).run();
  return sessionCookie(token, SESSION_DAYS * 86400);
}

async function currentUser(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await env.DB.prepare(
    "SELECT u.id, u.email, u.key_salt, u.key_hash, u.google_sub, s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"
  ).bind(await sha256Hex(token), Date.now()).first();
  return row || null;
}

async function checkKey(user, key) {
  if (!user.key_hash) return false;
  return safeEqual(await sha256Hex(user.key_salt, key), user.key_hash);
}

// ---------- Routes ----------

async function register(request, env) {
  const { body, error } = await readJson(request); if (error) return error;
  const email = normEmail(body.email), key = body.key;
  if (!validEmail(email)) return err(400, "bad_email");
  if (!validKey(key)) return err(400, "bad_key");
  const exists = await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first();
  if (exists) return err(409, "email_taken");
  const id = crypto.randomUUID();
  const salt = randomHex(16);
  const recovery = newRecoveryKey();
  await env.DB.prepare("INSERT INTO users (id, email, key_salt, key_hash, recovery_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, email, salt, await sha256Hex(salt, key), await sha256Hex(normRecovery(recovery)), Date.now()).run();
  const cookie = await createSession(env, id);
  return json(201, { email, recoveryKey: recovery }, { "set-cookie": cookie });
}

async function login(request, env) {
  const { body, error } = await readJson(request); if (error) return error;
  const email = normEmail(body.email), key = body.key;
  if (!validEmail(email) || !validKey(key)) return err(400, "bad_request");
  if (await tooManyAttempts(env, "login", email)) return err(429, "too_many_attempts");
  const user = await env.DB.prepare("SELECT id, email, key_salt, key_hash FROM users WHERE email = ?").bind(email).first();
  if (!user || !(await checkKey(user, key))) { await countAttempt(env, "login", email); return err(401, "bad_credentials"); }
  const cookie = await createSession(env, user.id);
  return json(200, { email: user.email }, { "set-cookie": cookie });
}

async function logout(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (/^[0-9a-f]{64}$/.test(token)) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  return json(200, { ok: true }, { "set-cookie": sessionCookie("", 0) });
}

async function me(request, env) {
  const user = await currentUser(request, env);
  if (!user) return err(401, "not_signed_in");
  return json(200, { email: user.email, hasPassword: !!user.key_hash, google: !!user.google_sub });
}

async function recover(request, env) {
  const { body, error } = await readJson(request); if (error) return error;
  const email = normEmail(body.email), key = body.key, rc = normRecovery(body.recoveryKey);
  if (!validEmail(email) || !validKey(key) || rc.length !== 25) return err(400, "bad_request");
  if (await tooManyAttempts(env, "recover", email)) return err(429, "too_many_attempts");
  const user = await env.DB.prepare("SELECT id, email, recovery_hash FROM users WHERE email = ?").bind(email).first();
  if (!user || !safeEqual(await sha256Hex(rc), user.recovery_hash)) { await countAttempt(env, "recover", email); return err(401, "bad_recovery"); }
  const salt = randomHex(16);
  const recovery = newRecoveryKey();
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET key_salt = ?, key_hash = ?, recovery_hash = ? WHERE id = ?")
      .bind(salt, await sha256Hex(salt, key), await sha256Hex(normRecovery(recovery)), user.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
  ]);
  const cookie = await createSession(env, user.id);
  return json(200, { email: user.email, recoveryKey: recovery }, { "set-cookie": cookie });
}

async function deleteAccount(request, env) {
  const { body, error } = await readJson(request); if (error) return error;
  const user = await currentUser(request, env);
  if (!user) return err(401, "not_signed_in");
  const ok = user.key_hash ? (validKey(body.key) && (await checkKey(user, body.key))) : body.confirm === "SUPPRIMER";
  if (!ok) return err(401, user.key_hash ? "bad_credentials" : "bad_confirm");
  await ensureTexts(env);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM texts WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM progress WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
  ]);
  return json(200, { ok: true }, { "set-cookie": sessionCookie("", 0) });
}

async function getProgress(request, env) {
  const user = await currentUser(request, env);
  if (!user) return err(401, "not_signed_in");
  const row = await env.DB.prepare("SELECT data, updated_at FROM progress WHERE user_id = ?").bind(user.id).first();
  return json(200, { data: row ? JSON.parse(row.data) : null, updatedAt: row ? row.updated_at : 0 });
}

// Écriture avec contrôle de version : si un autre appareil a écrit depuis la
// version connue (base), on renvoie 409 et l'état du serveur pour fusion.
async function putProgress(request, env) {
  const raw = await request.clone().text().catch(() => "");
  if (raw.length > MAX_PROGRESS_BYTES) return err(413, "too_large");
  const { body, error } = await readJson(request); if (error) return error;
  const user = await currentUser(request, env);
  if (!user) return err(401, "not_signed_in");
  if (!body || typeof body.data !== "object" || body.data === null || Array.isArray(body.data)) return err(400, "bad_request");
  const base = Number(body.base) || 0;
  const row = await env.DB.prepare("SELECT data, updated_at FROM progress WHERE user_id = ?").bind(user.id).first();
  if (row && row.updated_at > base) return json(409, { error: "conflict", data: JSON.parse(row.data), updatedAt: row.updated_at });
  const updatedAt = Math.max(Date.now(), row ? row.updated_at + 1 : 0);
  await env.DB.prepare(
    "INSERT INTO progress (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
  ).bind(user.id, JSON.stringify(body.data), updatedAt).run();
  return json(200, { updatedAt });
}


// ---------- Textes rédigés ----------
// La table est créée à la première utilisation (même schéma que migrations/0003_textes.sql).
let textsReady = false;
async function ensureTexts(env) {
  if (textsReady) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS texts (user_id TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, t INTEGER NOT NULL, PRIMARY KEY (user_id, k))").run();
  textsReady = true;
}

async function getTexts(request, env) {
  const user = await currentUser(request, env);
  if (!user) return err(401, "not_signed_in");
  await ensureTexts(env);
  const since = Math.max(0, Number(new URL(request.url).searchParams.get("since")) || 0);
  const { results } = await env.DB.prepare("SELECT k, v, t FROM texts WHERE user_id = ? AND t > ? ORDER BY t").bind(user.id, since).all();
  return json(200, { items: results || [] });
}

// Chaque texte porte l'heure de sa dernière modification (t) : le plus récent gagne.
async function putTexts(request, env) {
  const raw = await request.clone().text().catch(() => "");
  if (raw.length > MAX_TEXTS_BODY) return err(413, "too_large");
  const { body, error } = await readJson(request); if (error) return error;
  const user = await currentUser(request, env);
  if (!user) return err(401, "not_signed_in");
  const items = body && Array.isArray(body.items) ? body.items : null;
  if (!items || !items.length || items.length > MAX_TEXT_ITEMS) return err(400, "bad_request");
  const now = Date.now();
  for (const it of items) {
    if (!it || typeof it.k !== "string" || !TEXT_KEY.test(it.k) || typeof it.v !== "string" || it.v.length > MAX_TEXT_CHARS) return err(400, "bad_request");
    const t = Number(it.t); if (!Number.isFinite(t) || t <= 0) return err(400, "bad_request");
    it.t = Math.min(Math.floor(t), now + 60000);     // pas de date dans le futur
  }
  await ensureTexts(env);
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM texts WHERE user_id = ?").bind(user.id).first();
  if ((row ? row.n : 0) + items.length > MAX_TEXTS_PER_USER) return err(413, "too_many_texts");
  await env.DB.batch(items.map((it) => env.DB.prepare(
    "INSERT INTO texts (user_id, k, v, t) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, k) DO UPDATE SET v = excluded.v, t = excluded.t WHERE excluded.t > texts.t"
  ).bind(user.id, it.k, it.v, it.t)));
  return json(200, { ok: true });
}


// ---------- Connexion avec Google ----------

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const OAUTH_COOKIE = "bgo";
const googleEnabled = (env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function redirect(location, cookies = []) {
  const h = new Headers({ location, "cache-control": "no-store" });
  for (const c of cookies) h.append("set-cookie", c);
  return new Response(null, { status: 302, headers: h });
}
const oauthCookie = (value, maxAge) => `${OAUTH_COOKIE}=${value}; Path=/api/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const callbackUrl = (request) => new URL(request.url).origin + "/api/auth/google/callback";

async function authConfig(request, env) {
  // Indique quelle pièce manque, sans jamais révéler de valeur secrète.
  return json(200, { google: googleEnabled(env), googleClientId: !!env.GOOGLE_CLIENT_ID, googleSecret: !!env.GOOGLE_CLIENT_SECRET });
}

async function googleStart(request, env) {
  if (!googleEnabled(env)) return redirect("/?connexion=erreur&raison=google_indisponible");
  const state = randomHex(16);
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", enc.encode(verifier)));
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: callbackUrl(request), response_type: "code",
    scope: "openid email profile", state, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account",
  });
  return redirect(`${GOOGLE_AUTH}?${q}`, [oauthCookie(`${state}.${verifier}`, 600)]);
}

function decodeJwtPayload(jwt) {
  const part = String(jwt || "").split(".")[1];
  if (!part) return null;
  try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")), (c) => c.charCodeAt(0)))); }
  catch { return null; }
}

async function googleCallback(request, env) {
  // Le détail (code d'erreur Google, jamais un secret) aide à diagnostiquer la configuration.
  const fail = (raison, detail) => redirect(`/?connexion=erreur&raison=${raison}${detail ? "&detail=" + encodeURIComponent(String(detail).slice(0, 80)) : ""}`, [oauthCookie("", 0)]);
  if (!googleEnabled(env)) return fail("google_indisponible");
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return fail("google_annule");
  const [state, verifier] = getCookie(request, OAUTH_COOKIE).split(".");
  const code = url.searchParams.get("code");
  if (!state || !verifier || !code || !safeEqual(url.searchParams.get("state") || "", state)) return fail("google_session");

  let tok;
  try {
    const r = await fetch(GOOGLE_TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: callbackUrl(request), grant_type: "authorization_code", code_verifier: verifier }),
    });
    tok = await r.json();
    if (!r.ok) { console.error("Échange Google refusé :", r.status, JSON.stringify(tok).slice(0, 300)); return fail("google_refus", (tok && tok.error) || r.status); }
  } catch (e) { console.error("Google injoignable :", String(e)); return fail("google_injoignable", "reseau"); }

  // Jeton reçu directement de Google par une connexion TLS authentifiée par le secret
  // client : on vérifie ses champs sans revalider sa signature (OpenID Connect 3.1.3.7).
  const p = decodeJwtPayload(tok.id_token);
  const now = Math.floor(Date.now() / 1000);
  if (!p) return fail("google_jeton", "illisible");
  if (p.aud !== env.GOOGLE_CLIENT_ID) return fail("google_jeton", "aud");
  if (!["accounts.google.com", "https://accounts.google.com"].includes(p.iss)) return fail("google_jeton", "iss");
  if (!(p.exp > now) || !p.sub) return fail("google_jeton", "exp");
  if (!p.email || (p.email_verified !== true && p.email_verified !== "true")) return fail("google_email");
  const email = normEmail(p.email);

  let linked = false;
  let user = await env.DB.prepare("SELECT id FROM users WHERE google_sub = ?").bind(p.sub).first();
  if (!user) {
    user = await env.DB.prepare("SELECT id, key_hash FROM users WHERE email = ?").bind(email).first();
    if (user) {
      // Un compte à mot de passe n'a jamais prouvé qu'il possédait cette adresse : pour
      // empêcher qu'un tiers l'ait créé d'avance, on retire ce mot de passe et on ferme
      // ses sessions ; la connexion passe désormais par Google, qui a vérifié l'adresse.
      linked = !!user.key_hash;
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET google_sub = ?, key_salt = '', key_hash = '', recovery_hash = '' WHERE id = ?").bind(p.sub, user.id),
        env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
      ]);
    } else {
      user = { id: crypto.randomUUID() };
      await env.DB.prepare("INSERT INTO users (id, email, key_salt, key_hash, recovery_hash, created_at, google_sub) VALUES (?, ?, '', '', '', ?, ?)")
        .bind(user.id, email, Date.now(), p.sub).run();
    }
  }
  const session = await createSession(env, user.id);
  return redirect(linked ? "/?connexion=google&lie=1" : "/?connexion=google", [session, oauthCookie("", 0)]);
}

const ROUTES = {
  "POST /api/auth/register": register,
  "POST /api/auth/login": login,
  "POST /api/auth/logout": logout,
  "GET /api/auth/me": me,
  "POST /api/auth/recover": recover,
  "POST /api/auth/delete": deleteAccount,
  "GET /api/progress": getProgress,
  "PUT /api/progress": putProgress,
  "GET /api/texts": getTexts,
  "PUT /api/texts": putTexts,
  "GET /api/auth/config": authConfig,
  "GET /api/auth/google/start": googleStart,
  "GET /api/auth/google/callback": googleCallback,
};

export function isAccountRoute(pathname) {
  return pathname.startsWith("/api/auth/") || pathname === "/api/progress" || pathname === "/api/texts";
}

export async function handleAccount(request, env) {
  if (!env.DB) return err(500, "accounts_not_configured");
  const url = new URL(request.url);
  const fn = ROUTES[`${request.method} ${url.pathname}`];
  if (!fn) {
    const known = Object.keys(ROUTES).some((k) => k.endsWith(" " + url.pathname));
    return known ? err(405, "method_not_allowed") : err(404, "not_found");
  }
  try { return await fn(request, env); }
  catch (e) { console.error("Erreur compte :", String(e && e.stack || e)); return err(500, "server_error"); }
}

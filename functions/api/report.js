// Bristol EPS — signalement d'une erreur sur une fiche.
// Les signalements sont gardés dans D1 (table reports, créée au premier usage) ;
// pour les lire : Cloudflare → D1 → bristol-db → Console :
//   SELECT datetime(created_at / 1000, 'unixepoch') AS quand, card, kind, msg, q FROM reports ORDER BY created_at DESC;
// Limite : 10 signalements par heure et par adresse (empreinte, l'adresse n'est pas stockée).
import { json, err, readJson, currentUser } from "./account.js";

const KINDS = new Set(["fait", "date", "source", "orthographe", "autre", "relecture"]);
const CARD = /^[A-Za-z0-9_-]{1,40}$/;
let ready = false;
async function ensureReports(env) {
  if (ready) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, card TEXT NOT NULL, kind TEXT NOT NULL, msg TEXT NOT NULL, q TEXT NOT NULL, user_id TEXT, created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'nouveau')").run();
  ready = true;
}
async function hashIp(ip) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("bristol-report|" + ip));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function handleReport(request, env) {
  if (request.method !== "POST") return err(405, "method_not_allowed");
  if (!env.DB) return err(500, "accounts_not_configured");
  const { body, error } = await readJson(request); if (error) return error;
  const card = body && typeof body.card === "string" ? body.card : "";
  const kind = body && KINDS.has(body.kind) ? body.kind : "";
  const msg = body && typeof body.msg === "string" ? body.msg.trim() : "";
  const q = body && typeof body.q === "string" ? body.q.trim().slice(0, 400) : "";
  if (!CARD.test(card) || !kind || msg.length < 5 || msg.length > 1000) return err(400, "bad_request");
  if (env.QUOTA) {
    const k = `rep:${await hashIp(request.headers.get("cf-connecting-ip") || "local")}:${new Date().toISOString().slice(0, 13)}`;
    const n = parseInt((await env.QUOTA.get(k)) || "0", 10) || 0;
    if (n >= 10) return err(429, "too_many_reports");
    await env.QUOTA.put(k, String(n + 1), { expirationTtl: 7200 });
  }
  try {
    await ensureReports(env);
    const user = await currentUser(request, env).catch(() => null);
    await env.DB.prepare("INSERT INTO reports (card, kind, msg, q, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(card, kind, msg, q, user ? user.id : null, Date.now()).run();
  } catch (e) { console.error("Signalement :", String(e && e.stack || e)); return err(500, "server_error"); }
  return json(200, { ok: true });
}

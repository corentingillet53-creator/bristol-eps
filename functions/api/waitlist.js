// Bristol EPS — liste d'attente de l'ouverture du paiement.
// Une adresse laissée dans le paywall tant que le paiement n'est pas ouvert ; un seul e-mail
// est prévu, à l'ouverture, puis la liste est effacée (voir la politique de confidentialité).
// Table waitlist dans D1, créée au premier usage ; pour la lire : Cloudflare → D1 → bristol-db → Console :
//   SELECT email, concours, datetime(created_at / 1000, 'unixepoch') AS quand FROM waitlist ORDER BY created_at;
// Limite : 10 inscriptions par heure et par adresse IP (empreinte, l'IP n'est pas stockée).
import { json, err, readJson } from "./account.js";

let ready = false;
async function ensureWaitlist(env) {
  if (ready) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS waitlist (email TEXT PRIMARY KEY, concours TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)").run();
  ready = true;
}
async function hashIp(ip) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("bristol-waitlist|" + ip));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function handleWaitlist(request, env) {
  if (request.method !== "POST") return err(405, "method_not_allowed");
  if (!env.DB) return err(500, "accounts_not_configured");
  const { body, error } = await readJson(request); if (error) return error;
  const email = body && typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 160) : "";
  const concours = body && typeof body.concours === "string" && /^[a-z0-9-]{1,24}$/.test(body.concours) ? body.concours : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err(400, "bad_email");
  if (env.QUOTA) {
    const k = `wl:${await hashIp(request.headers.get("cf-connecting-ip") || "local")}:${new Date().toISOString().slice(0, 13)}`;
    const n = parseInt((await env.QUOTA.get(k)) || "0", 10) || 0;
    if (n >= 10) return err(429, "too_many");
    await env.QUOTA.put(k, String(n + 1), { expirationTtl: 7200 });
  }
  try {
    await ensureWaitlist(env);
    await env.DB.prepare("INSERT INTO waitlist (email, concours, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET concours = excluded.concours").bind(email, concours, Date.now()).run();
  } catch (e) { console.error("Liste d'attente :", String(e && e.stack || e)); return err(500, "server_error"); }
  return json(200, { ok: true });
}

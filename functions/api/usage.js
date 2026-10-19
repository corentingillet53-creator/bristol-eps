// Bristol EPS — compteurs atomiques dans D1 (table usage).
// KV ne sait pas incrémenter de façon atomique : deux demandes simultanées y lisent la même
// valeur et passent toutes les deux. Ici, chaque réservation est une seule requête SQL
// (INSERT … ON CONFLICT … WHERE … RETURNING), donc deux demandes ne peuvent pas prendre la même place.
// Chaque clé porte son échéance (exp, en ms) : une clé échue repart de zéro, et le cron l'efface.
let ready = false;
export async function ensureUsage(env) {
  if (ready) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS usage (k TEXT PRIMARY KEY, n INTEGER NOT NULL, exp INTEGER NOT NULL)").run();
  ready = true;
}

// Ajoute d à k sans condition ; renvoie la nouvelle valeur.
export async function bump(env, k, d, ttlMs, now = Date.now()) {
  await ensureUsage(env);
  const r = await env.DB.prepare(
    "INSERT INTO usage (k, n, exp) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET n = CASE WHEN usage.exp < ?4 THEN ?2 ELSE usage.n + ?2 END, exp = CASE WHEN usage.exp < ?4 THEN ?3 ELSE usage.exp END RETURNING n"
  ).bind(k, d, now + ttlMs, now).first();
  return r ? r.n : d;
}

// Ajoute d à k seulement si le total reste ≤ max ; renvoie la nouvelle valeur, ou null si c'est plein.
export async function take(env, k, d, max, ttlMs, now = Date.now()) {
  if (d > max) return null;
  await ensureUsage(env);
  const r = await env.DB.prepare(
    "INSERT INTO usage (k, n, exp) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET n = CASE WHEN usage.exp < ?4 THEN ?2 ELSE usage.n + ?2 END, exp = CASE WHEN usage.exp < ?4 THEN ?3 ELSE usage.exp END WHERE usage.exp < ?4 OR usage.n + ?2 <= ?5 RETURNING n"
  ).bind(k, d, now + ttlMs, now, max).first();
  return r ? r.n : null;
}

// Pose l'heure courante sur k si la précédente date d'au moins gapMs ; renvoie 0 si c'est fait,
// sinon le nombre de millisecondes à attendre.
export async function gate(env, k, gapMs, now = Date.now()) {
  await ensureUsage(env);
  const r = await env.DB.prepare(
    "INSERT INTO usage (k, n, exp) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET n = ?2, exp = ?3 WHERE usage.n <= ?4 RETURNING n"
  ).bind(k, now, now + gapMs + 60000, now - gapMs).first();
  if (r) return 0;
  const cur = await env.DB.prepare("SELECT n FROM usage WHERE k = ?").bind(k).first();
  return cur ? Math.max(1, cur.n + gapMs - now) : 0;
}

export async function peek(env, k, now = Date.now()) {
  await ensureUsage(env);
  const r = await env.DB.prepare("SELECT n FROM usage WHERE k = ? AND exp >= ?").bind(k, now).first();
  return r ? r.n : 0;
}

export async function forget(env, k) {
  await ensureUsage(env);
  await env.DB.prepare("DELETE FROM usage WHERE k = ?").bind(k).run();
}

// Ménage quotidien (cron) : clés échues.
export async function purgeUsage(env, now = Date.now()) {
  if (!env.DB) return 0;
  await ensureUsage(env);
  const r = await env.DB.prepare("DELETE FROM usage WHERE exp < ?").bind(now).run();
  return (r && r.meta && r.meta.changes) || 0;
}

// Empreinte courte d'une adresse IP (jamais stockée en clair).
export async function ipTag(request, salt) {
  const ip = request.headers.get("cf-connecting-ip") || "";
  if (!ip) return "";
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + "|" + ip));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Bristol EPS — droits d'accès (abonnement) d'un compte.
// Table subscriptions : une ligne par compte, tenue à jour par le webhook Stripe
// ou par un code d'accès bêta. Accès complet si l'échéance (until) n'est pas passée.
let ready = false;
export async function ensureSubs(env) {
  if (ready) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS subscriptions (user_id TEXT PRIMARY KEY, plan TEXT NOT NULL, status TEXT NOT NULL, until INTEGER NOT NULL, stripe_customer TEXT, stripe_sub TEXT, updated_at INTEGER NOT NULL)").run();
  ready = true;
}
// Fin du pass session : écrits et oraux 2027 compris (modifiable par la variable PASS_UNTIL).
export const passUntil = (env) => Date.parse((env.PASS_UNTIL || "2027-07-31") + "T23:59:59+02:00");
export async function getPlan(env, userId) {
  if (!env.DB || !userId) return { active: false };
  await ensureSubs(env);
  const r = await env.DB.prepare("SELECT plan, status, until, stripe_customer FROM subscriptions WHERE user_id = ?").bind(userId).first();
  if (!r) return { active: false };
  const active = r.until > Date.now() && r.status !== "canceled_now";
  return { active, plan: r.plan, status: r.status, until: r.until, portal: !!r.stripe_customer };
}
export async function setPlan(env, userId, p) {
  await ensureSubs(env);
  await env.DB.prepare(
    "INSERT INTO subscriptions (user_id, plan, status, until, stripe_customer, stripe_sub, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET plan = excluded.plan, status = excluded.status, until = excluded.until, stripe_customer = COALESCE(excluded.stripe_customer, subscriptions.stripe_customer), stripe_sub = COALESCE(excluded.stripe_sub, subscriptions.stripe_sub), updated_at = excluded.updated_at"
  ).bind(userId, p.plan, p.status, p.until, p.customer || null, p.sub || null, Date.now()).run();
}

// Bristol EPS — abonnement avec Stripe.
//
// - POST /api/billing/checkout {plan: "pass" | "mensuel"} : ouvre une page de paiement Stripe ;
//   « pass » = paiement unique, accès jusqu'à PASS_UNTIL ; « mensuel » = abonnement résiliable.
// - POST /api/billing/webhook : Stripe confirme les paiements (signature vérifiée).
// - POST /api/billing/portal : gérer ou résilier l'abonnement (portail client Stripe).
// - POST /api/billing/code {code} : code d'accès bêta (ACCESS_CODES) = accès complet jusqu'à PASS_UNTIL.
// - GET /api/billing/config : prix affichés et disponibilité du paiement.
//
// Réglages Cloudflare (Settings > Variables and Secrets), jamais dans ce dépôt :
//   STRIPE_SECRET_KEY (secret), STRIPE_WEBHOOK_SECRET (secret),
//   STRIPE_PRICE_PASS et STRIPE_PRICE_MONTHLY (identifiants « price_… » des tarifs créés dans Stripe),
//   facultatifs : PRICE_PASS_LABEL (« 49 € »), PRICE_MONTHLY_LABEL (« 9,90 € »), PASS_UNTIL (« 2027-07-31 »).
import { json, err, readJson, currentUser } from "./account.js";
import { getPlan, setPlan, passUntil, ensureSubs } from "./plan.js";

const enc = new TextEncoder();
const enabled = (env) => !!(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_PASS && env.STRIPE_PRICE_MONTHLY);

async function stripe(env, method, path, params) {
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const r = await fetch("https://api.stripe.com/v1" + path, {
    method, body,
    headers: { authorization: "Bearer " + env.STRIPE_SECRET_KEY, ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Stripe ${r.status} ${(data.error && data.error.message) || ""}`.trim());
  return data;
}

async function config(request, env) {
  const until = new Date(passUntil(env)).toISOString().slice(0, 10);
  return json(200, { enabled: enabled(env), codes: !!env.ACCESS_CODES, pass: { label: env.PRICE_PASS_LABEL || "49 €", until }, mensuel: { label: env.PRICE_MONTHLY_LABEL || "9,90 €" } });
}

async function checkout(request, env) {
  const { body, error } = await readJson(request); if (error) return error;
  const user = await currentUser(request, env);
  if (!user) return err(401, "not_signed_in");
  if (!enabled(env)) return err(503, "billing_disabled");
  const plan = body && body.plan === "mensuel" ? "mensuel" : body && body.plan === "pass" ? "pass" : "";
  if (!plan) return err(400, "bad_request");
  const cur = await getPlan(env, user.id);
  if (cur.active && cur.plan !== "code") return err(409, "already_premium");
  const origin = new URL(request.url).origin;
  const p = {
    mode: plan === "pass" ? "payment" : "subscription",
    "line_items[0][price]": plan === "pass" ? env.STRIPE_PRICE_PASS : env.STRIPE_PRICE_MONTHLY,
    "line_items[0][quantity]": "1",
    client_reference_id: user.id,
    customer_email: user.email,
    "metadata[user]": user.id, "metadata[plan]": plan,
    success_url: origin + "/app/?abonnement=ok",
    cancel_url: origin + "/app/?abonnement=annule",
    locale: "fr", allow_promotion_codes: "true",
  };
  if (plan === "pass") p.customer_creation = "always";
  else { p["subscription_data[metadata][user]"] = user.id; p["subscription_data[metadata][plan]"] = plan; }
  try { const s = await stripe(env, "POST", "/checkout/sessions", p); return json(200, { url: s.url }); }
  catch (e) { console.error("Checkout :", String(e)); return err(502, "stripe_error"); }
}

// Signature Stripe : en-tête « t=…,v1=… », HMAC-SHA256 de « t.corps » avec le secret du webhook.
export async function verifyStripe(raw, header, secret, now = Date.now()) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=")).filter((x) => x.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
  const sigs = header.split(",").filter((kv) => kv.trim().startsWith("v1=")).map((kv) => kv.trim().slice(3));
  const t = parseInt(parts.t, 10);
  if (!t || !sigs.length || Math.abs(now / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${raw}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((s) => s.length === mac.length && [...s].reduce((r, c, i) => r | (c.charCodeAt(0) ^ mac.charCodeAt(i)), 0) === 0);
}

const periodEnd = (sub) => 1000 * (sub.current_period_end || (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].current_period_end) || 0);
async function userOfSub(env, sub) {
  if (sub.metadata && sub.metadata.user) return sub.metadata.user;
  await ensureSubs(env);
  const r = await env.DB.prepare("SELECT user_id FROM subscriptions WHERE stripe_sub = ?").bind(sub.id).first();
  return r ? r.user_id : null;
}
async function syncSub(env, sub, userId) {
  userId = userId || await userOfSub(env, sub);
  if (!userId) return;
  const st = sub.status;
  const live = st === "active" || st === "trialing" || st === "past_due";
  await setPlan(env, userId, { plan: "mensuel", status: live ? st : "canceled", until: live ? periodEnd(sub) : Math.min(periodEnd(sub) || Date.now(), Date.now()), customer: sub.customer, sub: sub.id });
}

async function webhook(request, env) {
  const raw = await request.text();
  if (!await verifyStripe(raw, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET)) return err(400, "bad_signature");
  let ev; try { ev = JSON.parse(raw); } catch { return err(400, "bad_request"); }
  const o = (ev.data && ev.data.object) || {};
  try {
    if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") {
      const userId = (o.metadata && o.metadata.user) || o.client_reference_id;
      if (!userId) return json(200, { ok: true, ignored: "no_user" });
      if (o.mode === "payment" && o.payment_status === "paid") {
        await setPlan(env, userId, { plan: "pass", status: "active", until: passUntil(env), customer: o.customer });
      } else if (o.mode === "subscription" && o.subscription) {
        const sub = typeof o.subscription === "string" ? await stripe(env, "GET", "/subscriptions/" + o.subscription) : o.subscription;
        await syncSub(env, sub, userId);
      }
    } else if (ev.type === "customer.subscription.updated" || ev.type === "customer.subscription.deleted" || ev.type === "customer.subscription.created") {
      await syncSub(env, o);
    } else if (ev.type === "invoice.paid" && o.subscription) {
      await syncSub(env, await stripe(env, "GET", "/subscriptions/" + o.subscription));
    }
  } catch (e) { console.error("Webhook Stripe :", ev.type, String(e)); return err(500, "server_error"); }
  return json(200, { ok: true });
}

async function portal(request, env) {
  const { error } = await readJson(request); if (error) return error;
  const user = await currentUser(request, env);
  if (!user) return err(401, "not_signed_in");
  if (!enabled(env)) return err(503, "billing_disabled");
  await ensureSubs(env);
  const r = await env.DB.prepare("SELECT stripe_customer FROM subscriptions WHERE user_id = ?").bind(user.id).first();
  if (!r || !r.stripe_customer) return err(404, "no_customer");
  try { const s = await stripe(env, "POST", "/billing_portal/sessions", { customer: r.stripe_customer, return_url: new URL(request.url).origin + "/app/" }); return json(200, { url: s.url }); }
  catch (e) { console.error("Portail :", String(e)); return err(502, "stripe_error"); }
}

async function redeem(request, env) {
  const { body, error } = await readJson(request); if (error) return error;
  const user = await currentUser(request, env);
  if (!user) return err(401, "not_signed_in");
  const code = String((body && body.code) || "").trim();
  const codes = String(env.ACCESS_CODES || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (env.QUOTA) {
    const k = `code:${user.id}:${new Date().toISOString().slice(0, 13)}`, n = parseInt((await env.QUOTA.get(k)) || "0", 10) || 0;
    if (n >= 10) return err(429, "too_many_attempts");
    await env.QUOTA.put(k, String(n + 1), { expirationTtl: 7200 });
  }
  if (!code || !codes.includes(code)) return err(400, "bad_code");
  const cur = await getPlan(env, user.id);
  if (cur.active && cur.plan !== "code") return json(200, { ok: true, premium: cur });
  await setPlan(env, user.id, { plan: "code", status: "active", until: passUntil(env) });
  return json(200, { ok: true, premium: await getPlan(env, user.id) });
}

// À la suppression du compte : l'abonnement mensuel est résilié tout de suite chez Stripe.
export async function cancelBilling(env, userId) {
  if (!env.STRIPE_SECRET_KEY) return;
  await ensureSubs(env);
  const r = await env.DB.prepare("SELECT stripe_sub, status FROM subscriptions WHERE user_id = ?").bind(userId).first();
  if (r && r.stripe_sub && r.status !== "canceled") { try { await stripe(env, "DELETE", "/subscriptions/" + r.stripe_sub); } catch (e) { console.error("Résiliation :", String(e)); } }
}

const ROUTES = {
  "GET /api/billing/config": config,
  "POST /api/billing/checkout": checkout,
  "POST /api/billing/webhook": webhook,
  "POST /api/billing/portal": portal,
  "POST /api/billing/code": redeem,
};
export const isBillingRoute = (p) => p.startsWith("/api/billing/");
export async function handleBilling(request, env) {
  if (!env.DB) return err(500, "accounts_not_configured");
  const fn = ROUTES[`${request.method} ${new URL(request.url).pathname}`];
  if (!fn) return err(404, "not_found");
  try { return await fn(request, env); }
  catch (e) { console.error("Erreur abonnement :", String(e && e.stack || e)); return err(500, "server_error"); }
}

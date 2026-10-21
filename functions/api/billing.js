// Bristol EPS — abonnement avec Stripe.
//
// - POST /api/billing/checkout {plan: "pass" | "mensuel" | "recharge"} : ouvre une page de paiement Stripe ;
//   « pass » = paiement unique, accès jusqu'à PASS_UNTIL ; « mensuel » = abonnement résiliable ;
//   « recharge » = TOPUP_CREDITS crédits de retours de plus, pour un compte qui a déjà l'accès complet.
// - GET /api/billing/credits : crédits restants du compte (functions/api/credits.js).
// - POST /api/billing/webhook : Stripe confirme les paiements (signature vérifiée).
// - POST /api/billing/portal : gérer ou résilier l'abonnement (portail client Stripe).
// - POST /api/billing/code {code} : code d'accès bêta (ACCESS_CODES) = accès complet jusqu'à PASS_UNTIL,
//   pour CODE_MAX_USES comptes au plus par code (30 par défaut).
// - GET /api/billing/config : prix affichés et disponibilité du paiement.
//
// Réglages Cloudflare (Settings > Variables and Secrets), jamais dans ce dépôt :
//   STRIPE_SECRET_KEY (secret), STRIPE_WEBHOOK_SECRET (secret),
//   STRIPE_PRICE_PASS et STRIPE_PRICE_MONTHLY (identifiants « price_… » des tarifs créés dans Stripe),
//   facultatifs : PRICE_PASS_LABEL (« 80 € »), PRICE_MONTHLY_LABEL (« 15 € »), PASS_UNTIL (« 2027-07-31 »),
//   CODE_MAX_USES (30), STRIPE_PRICE_TOPUP (tarif de la recharge ; sans lui, pas de recharge),
//   PRICE_TOPUP_LABEL (« 5 € »), TOPUP_CREDITS (50), MONTHLY_CREDITS (60),
//   INVOICE_FOOTER (pied des factures du pass et de la recharge, « TVA non applicable, article 293 B du CGI »).
// Événements à cocher dans le webhook Stripe : checkout.session.completed,
// checkout.session.async_payment_succeeded, customer.subscription.created/updated/deleted,
// invoice.paid, charge.refunded, charge.dispute.created.
import { json, err, readJson, currentUser } from "./account.js";
import { getPlan, setPlan, passUntil, ensureSubs } from "./plan.js";
import { take, bump, peek, ipTag } from "./usage.js";
import { recordEvent, recordSource, cleanSource } from "./event.js";
import { creditState, addTopup, monthlyCredits, topupCredits } from "./credits.js";

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
  return json(200, { enabled: enabled(env), codes: !!env.ACCESS_CODES, pass: { label: env.PRICE_PASS_LABEL || "80 €", until }, mensuel: { label: env.PRICE_MONTHLY_LABEL || "15 €" },
    credits: monthlyCredits(env), recharge: { enabled: enabled(env) && !!env.STRIPE_PRICE_TOPUP, label: env.PRICE_TOPUP_LABEL || "5 €", credits: topupCredits(env) } });
}

async function credits(request, env) {
  const user = await currentUser(request, env);
  if (!user) return err(401, "not_signed_in");
  const plan = await getPlan(env, user.id);
  if (!plan.active) return json(200, { active: false });
  return json(200, { active: true, ...(await creditState(env, "u:" + user.id)) });
}

async function checkout(request, env) {
  const { body, error } = await readJson(request); if (error) return error;
  const user = await currentUser(request, env);
  if (!user) return err(401, "not_signed_in");
  if (!enabled(env)) return err(503, "billing_disabled");
  const plan = body && ["mensuel", "pass", "recharge"].includes(body.plan) ? body.plan : "";
  if (!plan) return err(400, "bad_request");
  if (plan === "recharge" && !env.STRIPE_PRICE_TOPUP) return err(503, "billing_disabled");
  const cur = await getPlan(env, user.id);
  if (plan === "recharge" ? !cur.active : cur.active && cur.plan !== "code") return err(plan === "recharge" ? 403 : 409, plan === "recharge" ? "premium_required" : "already_premium");
  const origin = new URL(request.url).origin;
  const p = {
    mode: plan === "mensuel" ? "subscription" : "payment",
    "line_items[0][price]": plan === "pass" ? env.STRIPE_PRICE_PASS : plan === "recharge" ? env.STRIPE_PRICE_TOPUP : env.STRIPE_PRICE_MONTHLY,
    "line_items[0][quantity]": "1",
    client_reference_id: user.id,
    "metadata[user]": user.id, "metadata[plan]": plan,
    // Provenance de la visite (utm_source gardé par la page) : comptée au paiement, voir event.js.
    ...(cleanSource(body.src) ? { "metadata[source]": cleanSource(body.src) } : {}),
    success_url: origin + (plan === "recharge" ? "/app/?recharge=ok" : "/app/?abonnement=ok"),
    cancel_url: origin + "/app/?abonnement=annule",
    locale: "fr", allow_promotion_codes: "true",
    // Pas de renonciation au droit de rétractation : remboursement intégral sur demande pendant 14 jours (CGV, article 5).
    "custom_text[submit][message]": "En payant, tu acceptes les conditions de vente (" + origin + "/cgv/). Satisfait ou remboursé pendant 14 jours.",
  };
  // Adresse vérifiée (Google) seulement : sinon Stripe la demande, et le reçu part à la bonne personne.
  if (user.google_sub) p.customer_email = user.email;
  // Le reçu Stripe (support durable, L221-13) rappelle le droit de rétractation.
  const recu = "Satisfait ou remboursé pendant 14 jours (CGV, article 5).";
  if (plan === "recharge") {
    // Nombre de crédits fixé au moment du paiement, relu par le webhook ; aussi sur le paiement (remboursement).
    const n = String(topupCredits(env));
    p["metadata[credits]"] = n;
    const r = await env.DB.prepare("SELECT stripe_customer FROM subscriptions WHERE user_id = ?").bind(user.id).first();
    if (r && r.stripe_customer) { p.customer = r.stripe_customer; delete p.customer_email; } else p.customer_creation = "always";
    p["payment_intent_data[description]"] = `Bristol EPS, recharge de ${n} retours de Claude. ` + recu;
    p["payment_intent_data[metadata][plan]"] = "recharge"; p["payment_intent_data[metadata][user]"] = user.id; p["payment_intent_data[metadata][credits]"] = n;
  } else if (plan === "pass") { p.customer_creation = "always"; p["payment_intent_data[description]"] = "Bristol EPS, pass session. " + recu; }
  // Paiement unique (pass, recharge) : facture Stripe numérotée, envoyée avec le reçu (note obligatoire au-delà de 25 €).
  if (plan !== "mensuel") { p["invoice_creation[enabled]"] = "true"; p["invoice_creation[invoice_data][footer]"] = (env.INVOICE_FOOTER || "TVA non applicable, article 293 B du CGI") + ". " + recu; }
  else { p["subscription_data[metadata][user]"] = user.id; p["subscription_data[metadata][plan]"] = plan; p["subscription_data[description]"] = "Bristol EPS, abonnement mensuel. " + recu; }
  // Prix de lancement : le code promo annoncé sur le site est appliqué d'avance au pass s'il est actif chez
  // Stripe (qui vérifie produit, date et nombre d'utilisations) ; sinon, le champ code promo reste proposé.
  const promo = plan === "pass" && typeof body.promo === "string" && /^[A-Za-z0-9_-]{3,40}$/.test(body.promo) ? body.promo : "";
  if (promo) {
    try {
      const l = await stripe(env, "GET", "/promotion_codes?active=true&limit=1&code=" + encodeURIComponent(promo));
      const pc = l && l.data && l.data[0];
      if (pc && pc.id) { delete p.allow_promotion_codes; p["discounts[0][promotion_code]"] = pc.id; }
    } catch (e) { console.error("Code promo :", String(e)); }
  }
  try { const s = await stripe(env, "POST", "/checkout/sessions", p); return json(200, { url: s.url }); }
  catch (e) {
    console.error("Checkout :", String(e));
    if (!p["discounts[0][promotion_code]"]) return err(502, "stripe_error");
  }
  // Code refusé par Stripe (produit, date) : page de paiement sans réduction d'avance, champ promo ouvert.
  delete p["discounts[0][promotion_code]"]; p.allow_promotion_codes = "true";
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
  // Abonnement remboursé ou contesté (canceled_now) : un événement tardif du même abonnement ne rouvre pas l'accès.
  await ensureSubs(env);
  const cur = await env.DB.prepare("SELECT status, stripe_sub FROM subscriptions WHERE user_id = ?").bind(userId).first();
  if (cur && cur.status === "canceled_now" && cur.stripe_sub === sub.id) return;
  const live = st === "active" || st === "trialing" || st === "past_due";
  await setPlan(env, userId, { plan: "mensuel", status: live ? st : "canceled", until: live ? periodEnd(sub) : Math.min(periodEnd(sub) || Date.now(), Date.now()), customer: sub.customer, sub: sub.id });
}

// Abonnement d'une facture : champ « subscription » des anciennes versions de l'API Stripe,
// « parent.subscription_details.subscription » depuis 2025-03.
const invoiceSub = (inv) => {
  const s = inv.subscription || (inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.subscription);
  return typeof s === "string" ? s : (s && s.id) || "";
};

async function webhook(request, env) {
  const raw = await request.text();
  if (!await verifyStripe(raw, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET)) return err(400, "bad_signature");
  let ev; try { ev = JSON.parse(raw); } catch { return err(400, "bad_request"); }
  const o = (ev.data && ev.data.object) || {};
  try {
    if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") {
      const userId = (o.metadata && o.metadata.user) || o.client_reference_id;
      if (!userId) return json(200, { ok: true, ignored: "no_user" });
      if (o.metadata && o.metadata.plan === "recharge") {
        // Stripe peut renvoyer le même événement : une seule recharge par session de paiement.
        if (o.payment_status === "paid" && await take(env, "stripe:" + o.id, 1, 1, 800 * 864e5) !== null) {
          await addTopup(env, "u:" + userId, parseInt(o.metadata.credits, 10) || 0);
          await recordEvent(env, "paid_recharge");
        }
      } else if (o.mode === "payment" && o.payment_status === "paid") {
        await setPlan(env, userId, { plan: "pass", status: "active", until: passUntil(env), customer: o.customer });
        await recordEvent(env, "paid_pass");
        await recordSource(env, "paid_pass", o.metadata && o.metadata.source);
      } else if (o.mode === "subscription" && o.subscription) {
        const sub = typeof o.subscription === "string" ? await stripe(env, "GET", "/subscriptions/" + o.subscription) : o.subscription;
        await syncSub(env, sub, userId);
        await recordEvent(env, "paid_mensuel");
        await recordSource(env, "paid_mensuel", o.metadata && o.metadata.source);
      }
    } else if (ev.type === "customer.subscription.updated" || ev.type === "customer.subscription.deleted" || ev.type === "customer.subscription.created") {
      await syncSub(env, o);
    } else if (ev.type === "invoice.paid" && invoiceSub(o)) {
      await syncSub(env, await stripe(env, "GET", "/subscriptions/" + invoiceSub(o)));
    } else if (ev.type === "charge.refunded" && o.refunded) {
      // Paiement remboursé en totalité : l'accès s'arrête tout de suite (une recharge : ses crédits seulement).
      if (!await revokeRecharge(env, o)) await revokeCustomer(env, o.customer, ev.type);
    } else if (ev.type === "charge.dispute.created") {
      // Paiement contesté : l'objet reçu est le litige, le client se lit sur son paiement.
      const ch = typeof o.charge === "string" ? await stripe(env, "GET", "/charges/" + o.charge) : o.charge;
      if (!await revokeRecharge(env, ch)) await revokeCustomer(env, ch && ch.customer, ev.type);
    }
  } catch (e) { console.error("Webhook Stripe :", ev.type, String(e)); return err(500, "server_error"); }
  return json(200, { ok: true });
}

// Paiement d'une recharge (métadonnées du paiement) : ses crédits sont retirés, une seule fois.
async function revokeRecharge(env, ch) {
  const pi = ch && ch.payment_intent;
  if (!pi) return false;
  const intent = typeof pi === "string" ? await stripe(env, "GET", "/payment_intents/" + pi) : pi;
  const m = (intent && intent.metadata) || {};
  if (m.plan !== "recharge" || !m.user) return false;
  if (await take(env, "stripe-back:" + (intent.id || pi), 1, 1, 800 * 864e5) !== null) await addTopup(env, "u:" + m.user, -(parseInt(m.credits, 10) || 0));
  return true;
}

async function revokeCustomer(env, customer, why) {
  if (!customer) return;
  await ensureSubs(env);
  const subs = await env.DB.prepare("SELECT stripe_sub FROM subscriptions WHERE stripe_customer = ? AND plan = 'mensuel' AND stripe_sub IS NOT NULL AND status NOT IN ('canceled', 'canceled_now')").bind(customer).all();
  const r = await env.DB.prepare("UPDATE subscriptions SET status = 'canceled_now', until = ?, updated_at = ? WHERE stripe_customer = ?").bind(Date.now(), Date.now(), customer).run();
  console.log("Accès retiré :", why, (r && r.meta && r.meta.changes) || 0, "compte(s)");
  // Mensuel remboursé ou contesté : l'abonnement est résilié tout de suite chez Stripe, sinon il serait prélevé
  // (et l'accès rouvert) au renouvellement suivant.
  for (const s of (subs && subs.results) || []) {
    try { await stripe(env, "DELETE", "/subscriptions/" + s.stripe_sub); console.log("Abonnement résilié :", why); }
    catch (e) { console.error("Résiliation après", why, ":", String(e)); }
  }
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
  // Essais faux : 10 par heure et par compte, et 10 par heure et par adresse IP.
  const hour = new Date().toISOString().slice(0, 13), ip = await ipTag(request, "bristol-code");
  const keys = [`codeu:${user.id}:${hour}`].concat(ip ? [`codefail:${ip}:${hour}`] : []);
  for (const k of keys) if ((await peek(env, k)) >= 10) return err(429, "too_many_attempts");
  if (!code || !codes.includes(code)) { for (const k of keys) await bump(env, k, 1, 2 * 36e5); return err(400, "bad_code"); }
  const cur = await getPlan(env, user.id);
  if (cur.active) return json(200, { ok: true, premium: cur });
  // Chaque code ouvre l'accès à CODE_MAX_USES comptes au plus.
  const tag = [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(code)))].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
  const max = parseInt(env.CODE_MAX_USES, 10) > 0 ? parseInt(env.CODE_MAX_USES, 10) : 30;
  if (await take(env, "codeuse:" + tag, 1, max, 800 * 864e5) === null) return err(410, "code_exhausted");
  await setPlan(env, user.id, { plan: "code", status: "active", until: passUntil(env) });
  await recordEvent(env, "code");
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
  "GET /api/billing/credits": credits,
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

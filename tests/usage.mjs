// Serveur : crédits (demandes simultanées, flux coupé par le client, recharge), codes d'accès,
// paiement (remboursements, litiges) et suppression de compte.
// D1 = SQLite en mémoire (d1mock.mjs), KV et API Claude / Stripe simulés.
import { onRequestPost, onRequestGet } from "../functions/api/feedback.js";
import { handleBilling } from "../functions/api/billing.js";
import { handleAccount } from "../functions/api/account.js";
import { makeD1, seedUser } from "./d1mock.mjs";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const kv = new Map();
const KV = { get: async k => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); } };
const DB = makeD1();
const q = (sql, ...a) => DB.sqlite.prepare(sql).get(...a);
const env = { ANTHROPIC_API_KEY: "k", QUOTA: KV, DB, MIN_INTERVAL_S: "0", DAILY_SHORT: "1000", MONTHLY_CREDITS: "2", GLOBAL_DAILY_CENTS: "1000", ACCESS_CODES: "EPS-BON-CODE", CODE_MAX_USES: "2", ADMIN_TOKEN: "jeton-admin-assez-long", STRIPE_SECRET_KEY: "sk", STRIPE_PRICE_PASS: "p1", STRIPE_PRICE_MONTHLY: "p2", STRIPE_WEBHOOK_SECRET: "whsec" };
const enc = new TextEncoder();

// API Claude simulée : 600 jetons de sortie, envoyés en plusieurs morceaux, lentement.
let calls = 0, stripeCalls = [], refuseDiscount = false, lastClaude = null;
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.startsWith("https://api.stripe.com")) {
    stripeCalls.push([init.method, url, init.body || ""]);
    if (url.endsWith("/checkout/sessions")) return refuseDiscount && /discounts/.test(init.body) ? Response.json({ error: { message: "coupon" } }, { status: 400 }) : Response.json({ url: "https://checkout.stripe.test/s" });
    if (url.includes("/promotion_codes")) return Response.json({ data: url.includes("code=LANCEMENT20") ? [{ id: "promo_1" }] : [] });
    if (url.includes("/charges/")) return Response.json({ id: "ch_1", customer: "cus_D" });
    if (init.method === "GET" && url.endsWith("/subscriptions/sub_N")) return Response.json({ id: "sub_N", status: "active", customer: "cus_N", metadata: { user: "n1" }, items: { data: [{ current_period_end: 4102444800 }] } });
    return Response.json({});
  }
  calls++; lastClaude = JSON.parse(init.body);
  let i = 0;
  const body = new ReadableStream({
    async pull(c) {
      await new Promise(r => setTimeout(r, 5));
      if (i === 0) c.enqueue(enc.encode('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1000}}}\n\n'));
      else if (i < 6) c.enqueue(enc.encode('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"morceau ' + i + ' "}}\n\n'));
      else if (i === 6) c.enqueue(enc.encode('event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":600}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'));
      else c.close();
      i++;
    },
  });
  return new Response(body, { status: 200 });
};
// Coût réel d'un retour : 1000 × 2 + 600 × 10 = 8 000 micro-dollars ; 2 crédits par mois.
const REAL = 8000, CREDITS = 2;
const waits = [];
const ctx = { waitUntil: p => waits.push(p) };
const settle = async () => { while (waits.length) await waits.shift(); };

const cookie = await seedUser(DB, "abo");
DB.sqlite.prepare("INSERT INTO subscriptions (user_id, plan, status, until, stripe_customer, updated_at) VALUES ('abo', 'mensuel', 'active', ?, 'cus_A', 0)").run(Date.now() + 864e5);
const fb = (n, h = {}) => new Request("https://x.dev/api/feedback", { method: "POST", headers: { "content-type": "application/json", cookie, "cf-connecting-ip": "9.9.9.9", ...h }, body: JSON.stringify({ kind: "plan", fmt: "b3", epreuve: "e1", subject: "Sujet " + n, contexte: "", notes: "x".repeat(60) + n, facts: [] }) });
const month = new Date().toISOString().slice(0, 7);
const spent = () => (q("SELECT n FROM usage WHERE k = ?", "c:u:abo:" + month) || { n: 0 }).n;

// B1 a. Vingt demandes simultanées : jamais plus de retours que de crédits.
const res = await Promise.all(Array.from({ length: 20 }, (_, i) => onRequestPost({ request: fb("sim" + i), env, ctx })));
const passed = res.filter(r => r.status === 200);
await Promise.all(passed.map(r => r.text())); await settle();
ok(passed.length === CREDITS && calls === CREDITS, `20 demandes simultanées : ${passed.length} appels à Claude (${CREDITS} crédits)`);
ok(spent() === passed.length * REAL, `coût réel suivi (${spent()})`);
const refused = res.filter(r => r.status === 402);
const body402 = refused.length ? await refused[0].json() : {};
ok(refused.length === 20 - CREDITS && body402.error === "no_credits" && body402.credits && body402.credits.left === 0, "les autres : 402 no_credits, avec le solde");
ok(passed.every(r => /^[01]\/0\/1$/.test(r.headers.get("x-credits") || "")), "en-tête x-credits : mois/recharge/coût " + passed.map(r => r.headers.get("x-credits")));

// B1 b. Flux coupé par le client : le coût réel est quand même compté.
ok(lastClaude && lastClaude.max_tokens === 4000 && lastClaude.output_config && lastClaude.output_config.effort === "low", "retour : réflexion courte et marge de 4 000 jetons");
DB.sqlite.prepare("DELETE FROM usage").run(); calls = 0;
const r1 = await onRequestPost({ request: fb("cut"), env, ctx });
const rd = r1.body.getReader(); await rd.read(); await rd.cancel();
await settle();
ok(calls === 1 && spent() === REAL, `flux coupé après le premier morceau : coût compté ${spent()} (attendu ${REAL})`);
ok([...kv.keys()].some(k => k.startsWith("h:")), "flux coupé : le retour est quand même mis en cache");

// Délai minimal entre deux demandes (MIN_INTERVAL_S) : atomique aussi.
DB.sqlite.prepare("DELETE FROM usage").run();
const env2 = { ...env, MIN_INTERVAL_S: "60", BUDGET_CENTS: "200" };
const two = await Promise.all([onRequestPost({ request: fb("g1"), env: env2, ctx }), onRequestPost({ request: fb("g2"), env: env2, ctx })]);
await Promise.all(two.map(r => r.text())); await settle();
ok(two.map(r => r.status).sort().join() === "200,429", "deux demandes simultanées avec délai de 60 s : une seule passe " + two.map(r => r.status));

// Code d'accès faux : 10 essais par heure et par adresse, puis 429.
DB.sqlite.prepare("DELETE FROM usage").run();
const codeReq = (c, ip = "5.5.5.5") => new Request("https://x.dev/api/feedback", { method: "POST", headers: { "content-type": "application/json", "x-access-code": c, "cf-connecting-ip": ip }, body: JSON.stringify({ kind: "plan", fmt: "b3", epreuve: "e1", subject: "S", notes: "x".repeat(60), facts: [] }) });
const st = [];
for (let i = 0; i < 12; i++) st.push((await onRequestPost({ request: codeReq("FAUX-" + i), env, ctx })).status);
ok(st.slice(0, 10).every(s => s === 401) && st.slice(10).every(s => s === 429), "codes faux : 10 refus puis blocage " + st.join(","));
ok((await onRequestPost({ request: codeReq("EPS-BON-CODE"), env, ctx })).status === 429, "même le bon code est bloqué pendant l'heure sur cette adresse");
const okCode = await onRequestPost({ request: codeReq("EPS-BON-CODE", "6.6.6.6"), env, ctx }); await okCode.text(); await settle();
ok(okCode.status === 200, "bon code depuis une autre adresse : accepté");

// Diagnostic : rien sans le jeton d'administration.
const g0 = await (await onRequestGet({ request: new Request("https://x.dev/api/feedback"), env })).json();
const g1 = await (await onRequestGet({ request: new Request("https://x.dev/api/feedback", { headers: { "x-admin-token": env.ADMIN_TOKEN } }), env })).json();
ok(JSON.stringify(g0) === '{"ok":true}' && g1.accessCodes === 1, "diagnostic réservé au jeton d'administration");

// Codes d'accès sur le compte (billing/code) : limite d'essais et nombre de comptes par code.
const users = {};
for (const u of ["c1", "c2", "c3"]) users[u] = await seedUser(DB, u);
const bill = (path, body, u, h = {}) => handleBilling(new Request("https://x.dev/api/billing/" + path, { method: "POST", headers: { "content-type": "application/json", cookie: users[u] || "", "cf-connecting-ip": "7.7.7.7", ...h }, body: JSON.stringify(body) }), env);
const rs = [];
for (let i = 0; i < 11; i++) rs.push((await bill("code", { code: "X" + i }, "c1")).status);
ok(rs.slice(0, 10).every(s => s === 400) && rs[10] === 429, "billing/code : 10 codes faux puis 429 " + rs.join(","));
ok((await bill("code", { code: "EPS-BON-CODE" }, "c2", { "cf-connecting-ip": "8.8.8.1" })).status === 200, "code : 1er compte activé");
ok((await bill("code", { code: "EPS-BON-CODE" }, "c3", { "cf-connecting-ip": "8.8.8.2" })).status === 200, "code : 2e compte activé");
users.c4 = await seedUser(DB, "c4");
ok((await bill("code", { code: "EPS-BON-CODE" }, "c4", { "cf-connecting-ip": "8.8.8.3" })).status === 410, "code : 3e compte refusé (CODE_MAX_USES = 2)");
ok((await bill("code", { code: "EPS-BON-CODE" }, "c2", { "cf-connecting-ip": "8.8.8.1" })).status === 200, "code : un compte déjà activé n'use pas une place de plus");

// Paiement : pas de renonciation, le droit de rétractation de 14 jours est rappelé au paiement et sur le reçu.
users.p1 = await seedUser(DB, "p1");
const co = await bill("checkout", { plan: "pass" }, "p1");
const sent = new URLSearchParams(stripeCalls.at(-1)[2]);
ok(co.status === 200 && !sent.has("metadata[renonciation]") && /remboursé pendant 14 jours/.test(sent.get("payment_intent_data[description]")) && /remboursé pendant 14 jours/.test(sent.get("custom_text[submit][message]")) && !sent.has("customer_email"), "paiement sans case : rétractation rappelée au paiement et sur le reçu, adresse non vérifiée non préremplie");

// Prix de lancement : le code promo est appliqué d'avance au pass, sinon le champ promo reste ouvert.
const coP = await bill("checkout", { plan: "pass", promo: "LANCEMENT20" }, "p1");
const sentP = new URLSearchParams(stripeCalls.at(-1)[2]);
ok(coP.status === 200 && sentP.get("discounts[0][promotion_code]") === "promo_1" && !sentP.has("allow_promotion_codes"), "pass : code promo appliqué d'avance");
await bill("checkout", { plan: "pass", promo: "INCONNU" }, "p1");
const sentU = new URLSearchParams(stripeCalls.at(-1)[2]);
ok(!sentU.has("discounts[0][promotion_code]") && sentU.get("allow_promotion_codes") === "true", "code promo inconnu : champ promo ouvert");
await bill("checkout", { plan: "mensuel", promo: "LANCEMENT20" }, "p1");
ok(!new URLSearchParams(stripeCalls.at(-1)[2]).has("discounts[0][promotion_code]"), "mensuel : code promo du pass jamais appliqué");
refuseDiscount = true;
const coR0 = await bill("checkout", { plan: "pass", promo: "LANCEMENT20" }, "p1");
const sentR0 = new URLSearchParams(stripeCalls.at(-1)[2]);
ok(coR0.status === 200 && !sentR0.has("discounts[0][promotion_code]") && sentR0.get("allow_promotion_codes") === "true", "code refusé par Stripe : paiement ouvert sans réduction d'avance");
refuseDiscount = false;
await bill("checkout", { plan: "pass", src: "Google-Ads<x>" }, "p1");
const sentS = new URLSearchParams(stripeCalls.at(-1)[2]);
await bill("checkout", { plan: "pass" }, "p1");
ok(sentS.get("metadata[source]") === "google-adsx" && !new URLSearchParams(stripeCalls.at(-1)[2]).has("metadata[source]"), "provenance de la visite transmise à Stripe, nettoyée");
ok(sentS.get("invoice_creation[enabled]") === "true" && /293 B/.test(sentS.get("invoice_creation[invoice_data][footer]") || ""), "pass : facture Stripe avec la mention 293 B");
await bill("checkout", { plan: "mensuel" }, "p1");
ok(!new URLSearchParams(stripeCalls.at(-1)[2]).has("invoice_creation[enabled]"), "mensuel : factures de l'abonnement laissées à Stripe");

// Remboursement et litige : l'accès s'arrête.
const hook = async ev => { const raw = JSON.stringify(ev), t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey("raw", enc.encode(env.STRIPE_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(t + "." + raw)))].map(b => b.toString(16).padStart(2, "0")).join("");
  return (await handleBilling(new Request("https://x.dev/api/billing/webhook", { method: "POST", headers: { "stripe-signature": `t=${t},v1=${sig}` }, body: raw }), env)).status; };
for (const [u, c] of [["r1", "cus_R"], ["d1", "cus_D"]]) DB.sqlite.prepare("INSERT INTO subscriptions (user_id, plan, status, until, stripe_customer, updated_at) VALUES (?, 'pass', 'active', ?, ?, 0)").run(u, Date.now() + 864e5, c);
ok(await hook({ type: "charge.refunded", data: { object: { customer: "cus_R", refunded: false } } }) === 200 && q("SELECT status FROM subscriptions WHERE user_id = 'r1'").status === "active", "remboursement partiel : accès gardé");
ok(await hook({ type: "charge.refunded", data: { object: { customer: "cus_R", refunded: true } } }) === 200 && q("SELECT status FROM subscriptions WHERE user_id = 'r1'").status === "canceled_now", "remboursement total : accès retiré");
ok(await hook({ type: "charge.dispute.created", data: { object: { charge: "ch_1" } } }) === 200 && q("SELECT status FROM subscriptions WHERE user_id = 'd1'").status === "canceled_now", "litige : accès retiré (client lu sur le paiement)");

// Mensuel remboursé : l'abonnement est résilié chez Stripe, et un événement tardif ne rouvre pas l'accès.
DB.sqlite.prepare("INSERT INTO subscriptions (user_id, plan, status, until, stripe_customer, stripe_sub, updated_at) VALUES ('m1', 'mensuel', 'active', ?, 'cus_M', 'sub_M', 0)").run(Date.now() + 864e5);
stripeCalls = [];
ok(await hook({ type: "charge.refunded", data: { object: { customer: "cus_M", refunded: true } } }) === 200 && q("SELECT status FROM subscriptions WHERE user_id = 'm1'").status === "canceled_now"
  && stripeCalls.some(([m, u]) => m === "DELETE" && u.endsWith("/subscriptions/sub_M")), "mensuel remboursé : accès retiré et abonnement résilié chez Stripe");
ok(await hook({ type: "customer.subscription.updated", data: { object: { id: "sub_M", status: "active", customer: "cus_M", metadata: { user: "m1" }, current_period_end: 4102444800 } } }) === 200
  && q("SELECT status FROM subscriptions WHERE user_id = 'm1'").status === "canceled_now", "mensuel remboursé : un événement tardif ne rouvre pas l'accès");
stripeCalls = [];
await hook({ type: "charge.refunded", data: { object: { customer: "cus_R", refunded: true } } });
ok(!stripeCalls.some(([m]) => m === "DELETE"), "pass remboursé : aucune résiliation demandée à Stripe");
// Renouvellement : facture au format récent de l'API Stripe (abonnement sous parent.subscription_details).
DB.sqlite.prepare("INSERT INTO subscriptions (user_id, plan, status, until, stripe_customer, stripe_sub, updated_at) VALUES ('n1', 'mensuel', 'active', ?, 'cus_N', 'sub_N', 0)").run(Date.now() + 864e5);
ok(await hook({ type: "invoice.paid", data: { object: { customer: "cus_N", parent: { subscription_details: { subscription: "sub_N" } } } } }) === 200
  && q("SELECT until FROM subscriptions WHERE user_id = 'n1'").until === 4102444800000, "renouvellement lu sur une facture au format récent");

// Recharge : réservée aux abonnés, créditée une seule fois, utilisée après les crédits du mois.
const credOf = async () => (await (await handleBilling(new Request("https://x.dev/api/billing/credits", { headers: { cookie } }), env)).json());
ok((await bill("checkout", { plan: "recharge" }, "p1")).status === 503, "recharge sans tarif Stripe : 503");
env.STRIPE_PRICE_TOPUP = "p3"; env.TOPUP_CREDITS = "5";
ok((await bill("checkout", { plan: "recharge" }, "p1")).status === 403, "recharge sans accès complet : 403");
users.abo = cookie;
const coR = await bill("checkout", { plan: "recharge" }, "abo");
const sentR = new URLSearchParams(stripeCalls.at(-1)[2]);
ok(coR.status === 200 && sentR.get("mode") === "payment" && sentR.get("line_items[0][price]") === "p3" && sentR.get("customer") === "cus_A" && sentR.get("payment_intent_data[metadata][credits]") === "5", "recharge : paiement unique, client Stripe réutilisé, crédits dans les métadonnées");
const cfg = await (await handleBilling(new Request("https://x.dev/api/billing/config"), env)).json();
ok(cfg.credits === 2 && cfg.recharge.enabled && cfg.recharge.credits === 5, "config : crédits du mois et recharge");
const paidEv = { type: "checkout.session.completed", data: { object: { id: "cs_R", mode: "payment", payment_status: "paid", client_reference_id: "abo", metadata: { user: "abo", plan: "recharge", credits: "5" } } } };
ok(await hook(paidEv) === 200 && await hook(paidEv) === 200, "webhook de recharge reçu deux fois");
DB.sqlite.prepare("INSERT OR REPLACE INTO usage (k, n, exp) VALUES (?, 2, ?)").run("cr:u:abo:" + month, Date.now() + 864e5);
let cr = await credOf();
ok(cr.active && cr.month === 0 && cr.topup === 5 && cr.left === 5 && q("SELECT plan FROM subscriptions WHERE user_id = 'abo'").plan === "mensuel", "recharge créditée une fois (5), abonnement inchangé " + JSON.stringify(cr));
const one = await onRequestPost({ request: fb("rech1"), env, ctx }); await one.text(); await settle();
const copie = new Request("https://x.dev/api/feedback", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ kind: "copie", fmt: "aint", epreuve: "e2", subject: "Copie", duree: "6 h", minutes: 300, notes: "c".repeat(300) }) });
const cp = await onRequestPost({ request: copie, env, ctx }); await cp.text(); await settle();
cr = await credOf();
ok(one.status === 200 && cp.status === 200 && cr.topup === 1 && cp.headers.get("x-credits") === "0/1/3", "retour court (1) puis copie (3) pris sur la recharge : reste " + cr.topup);
const four = await onRequestPost({ request: fb("rech2"), env, ctx }); await four.text(); await settle();
const five = await onRequestPost({ request: fb("rech3"), env, ctx });
ok(four.status === 200 && five.status === 402 && (await credOf()).left === 0, "dernier crédit utilisé, puis 402");
// Flux en erreur sans texte : le crédit est rendu.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => String(url).startsWith("https://api.stripe.com") ? realFetch(url, init) : new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode('event: error\ndata: {"type":"error","error":{"type":"overloaded_error"}}\n\n')); c.close(); } }), { status: 200 });
await addTopupTest(1);
const er = await onRequestPost({ request: fb("err"), env, ctx }); await er.text(); await settle();
globalThis.fetch = realFetch;
ok(er.status === 200 && (await credOf()).topup === 1, "flux en erreur sans texte : crédit rendu");
// Refus du modèle en cours de texte : crédits rendus, message transmis, rien en cache.
globalThis.fetch = async (url, init) => String(url).startsWith("https://api.stripe.com") ? realFetch(url, init) : new Response(new ReadableStream({ start(c) {
  c.enqueue(enc.encode('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1000}}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"début du retour "}}\n\n'));
  c.enqueue(enc.encode('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"refusal","stop_details":{"category":"general_harms"}},"usage":{"output_tokens":40}}\n\n')); c.close(); } }), { status: 200 });
const kvBefore = kv.size;
const rf = await onRequestPost({ request: fb("refus"), env, ctx }); const rfText = await rf.text(); await settle();
globalThis.fetch = realFetch;
ok(rf.status === 200 && /"refused":true/.test(rfText) && (await credOf()).topup === 1 && kv.size === kvBefore, "refus du modèle : crédit rendu, rien en cache");
ok(q("SELECT SUM(n) AS n FROM stats WHERE e = 'refusal'").n === 1, "refus du modèle compté dans le tableau de bord");
// Plafond du jour atteint : refus compté.
env.GLOBAL_DAILY_CENTS = "0";
const pz = await onRequestPost({ request: fb("pause"), env, ctx });
env.GLOBAL_DAILY_CENTS = "1000";
ok(pz.status === 503 && q("SELECT SUM(n) AS n FROM stats WHERE e = 'paused'").n === 1, "plafond du jour : 503 et refus compté");
// Remboursement d'une recharge : ses crédits sont retirés, l'accès reste.
const refundEv = { type: "charge.refunded", data: { object: { customer: "cus_A", refunded: true, payment_intent: { id: "pi_R", metadata: { plan: "recharge", user: "abo", credits: "5" } } } } };
ok(await hook(refundEv) === 200 && await hook(refundEv) === 200 && (await credOf()).topup === 0 && q("SELECT status FROM subscriptions WHERE user_id = 'abo'").status === "active", "recharge remboursée : crédits retirés une fois, abonnement gardé");
async function addTopupTest(n) { const { addTopup } = await import("../functions/api/credits.js"); await addTopup(env, "u:abo", n); }

// Suppression de compte : plus rien ne renvoie à la personne.
DB.sqlite.prepare("INSERT INTO reports (card, kind, msg, q, user_id, created_at, email) VALUES ('x', 'k', 'm', 'q', 'abo', 0, 'abo@ex.fr')").run();
DB.sqlite.prepare("INSERT INTO waitlist (email, created_at) VALUES ('abo@ex.fr', 0)").run();
DB.sqlite.prepare("INSERT INTO push_subs (endpoint, user_id, p256dh, auth, hm, origin, created_at) VALUES ('e', 'abo', '', '', '', '', 0)").run();
const del = await handleAccount(new Request("https://x.dev/api/auth/delete", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ confirm: "SUPPRIMER" }) }), env);
const left = ["users WHERE id = 'abo'", "subscriptions WHERE user_id = 'abo'", "push_subs WHERE user_id = 'abo'", "waitlist WHERE email = 'abo@ex.fr'", "reports WHERE user_id = 'abo' OR email = 'abo@ex.fr'", "usage WHERE k LIKE '%abo%'"].map(t => q("SELECT COUNT(*) AS n FROM " + t).n);
ok(del.status === 200 && left.every(n => n === 0) && q("SELECT COUNT(*) AS n FROM reports").n === 1, "suppression du compte : tout effacé, signalement anonymisé " + left.join(","));

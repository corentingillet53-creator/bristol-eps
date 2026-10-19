// Serveur : retour offert (un par compte, limité par adresse IP et par jour) et liste d'attente,
// avec D1 (SQLite en mémoire), KV et API Claude simulés.
import { onRequestPost } from "../functions/api/feedback.js";
import { handleWaitlist } from "../functions/api/waitlist.js";
import { makeD1, seedUser } from "./d1mock.mjs";
const kvStore = new Map();
const KV = { get: async k => kvStore.has(k) ? kvStore.get(k) : null, put: async (k, v) => { kvStore.set(k, v); }, delete: async k => { kvStore.delete(k); } };
const DB = makeD1();
const n = sql => DB.sqlite.prepare(sql).get();
let upstreamOk = true;
globalThis.fetch = async () => { if (!upstreamOk) return new Response(JSON.stringify({ error: { type: "overloaded_error", message: "x" } }), { status: 529 });
  const enc = new TextEncoder(); const body = new ReadableStream({ start(c) { c.enqueue(enc.encode('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"## Ce qui fonctionne\\n- bien"}}\n\nevent: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":10}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n')); c.close(); } });
  return new Response(body, { status: 200 }); };
const env = { ANTHROPIC_API_KEY: "k", QUOTA: KV, DB, MIN_INTERVAL_S: "0" };
const cookies = {};
for (const u of ["u1", "u2", "u3", "u4", "u5"]) cookies[u] = await seedUser(DB, u);
const req = (body, h = {}, u = "u1", ip = "1.1.1.1") => new Request("https://x.dev/api/feedback", { method: "POST", headers: { "content-type": "application/json", cookie: cookies[u], "cf-connecting-ip": ip, ...h }, body: JSON.stringify(body) });
const body = n => ({ kind: "plan", fmt: "b3", epreuve: "e1", subject: "Sujet " + n, contexte: "", notes: "x".repeat(60) + n, facts: [] });
const out = async r => { const res = await r; const t = await res.text(); return [res.status, res.headers.get("x-trial"), t.slice(0, 40)]; };
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const trialOf = u => n(`SELECT n FROM usage WHERE k = 'trial:${u}'`);
let r = await out(onRequestPost({ request: req(body(1)), env }));             ok(r[0] === 402, "sans essai : 402 " + r);
upstreamOk = false;
r = await out(onRequestPost({ request: req(body(1), { "x-trial": "1" }), env })); ok(r[0] === 503 && !trialOf("u1"), "échec amont : essai rendu " + r);
upstreamOk = true;
r = await out(onRequestPost({ request: req(body(1), { "x-trial": "1" }), env })); ok(r[0] === 200 && r[1] === "1" && trialOf("u1"), "essai accordé " + r);
r = await out(onRequestPost({ request: req(body(2), { "x-trial": "1" }), env })); ok(r[0] === 402 && /trial_used/.test(r[2]), "second essai refusé " + r);
r = await out(onRequestPost({ request: new Request("https://x.dev/api/feedback", { method: "POST", headers: { "content-type": "application/json", "x-trial": "1" }, body: JSON.stringify(body(3)) }), env })); ok(r[0] === 401 && /login_required/.test(r[2]), "sans compte : 401 " + r);
// Deux onglets en même temps : un seul essai passe.
const two = await Promise.all([onRequestPost({ request: req(body(5), { "x-trial": "1" }, "u2", "2.2.2.2"), env }), onRequestPost({ request: req(body(6), { "x-trial": "1" }, "u2", "2.2.2.2"), env })].map(out));
ok(two.filter(x => x[0] === 200).length === 1 && two.filter(x => x[0] === 402).length === 1, "deux essais simultanés : un seul accordé " + JSON.stringify(two));
// Plusieurs comptes depuis la même adresse : 3 essais par jour (TRIAL_PER_IP).
r = await out(onRequestPost({ request: req(body(7), { "x-trial": "1" }, "u3", "2.2.2.2"), env })); ok(r[0] === 200, "2e compte, même adresse : accordé " + r);
r = await out(onRequestPost({ request: req(body(8), { "x-trial": "1" }, "u4", "2.2.2.2"), env })); ok(r[0] === 200, "3e compte, même adresse : accordé " + r);
r = await out(onRequestPost({ request: req(body(9), { "x-trial": "1" }, "u5", "2.2.2.2"), env })); ok(r[0] === 503 && /trial_closed/.test(r[2]) && !trialOf("u5"), "4e compte, même adresse : refusé, essai non consommé " + r);
// Plafond global du jour.
DB.sqlite.prepare("INSERT INTO usage (k, n, exp) VALUES (?, 30, ?) ON CONFLICT(k) DO UPDATE SET n = 30").run("trialday:" + new Date().toISOString().slice(0, 10), Date.now() + 864e5);
r = await out(onRequestPost({ request: req(body(10), { "x-trial": "1" }, "u5", "3.3.3.3"), env })); ok(r[0] === 503 && /trial_closed/.test(r[2]) && !trialOf("u5"), "plafond du jour " + r);
r = await out(onRequestPost({ request: req({ kind: "copie" }, { "x-trial": "1" }, "u5"), env })); ok(r[0] === 400 || r[0] === 402, "copie refusée à l'essai " + r);
// Ancien marqueur KV (avant le passage à D1) : toujours respecté.
kvStore.set("trial:u5", "1"); DB.sqlite.prepare("DELETE FROM usage").run();
r = await out(onRequestPost({ request: req(body(11), { "x-trial": "1" }, "u5", "4.4.4.4"), env })); ok(r[0] === 402 && /trial_used/.test(r[2]), "ancien essai KV respecté " + r);
const wl = async b => (await handleWaitlist(new Request("https://x.dev/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }), env)).status;
ok(await wl({ email: "Test@Ex.fr", concours: "capeps-l3" }) === 200 && n("SELECT email FROM waitlist").email === "test@ex.fr", "liste d'attente enregistrée");
ok(await wl({ email: "pas-une-adresse" }) === 400, "adresse invalide refusée");

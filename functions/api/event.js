// Bristol EPS — mesure d'audience anonyme, sans cookie.
// Le navigateur envoie au plus une fois chaque étape du parcours (première ouverture, première
// fiche, premier retour de Claude, retour après 7 et 30 jours…) ; le serveur n'ajoute que +1 à un
// compteur du jour, par étape et par concours. Aucun identifiant, aucune adresse IP n'est stocké
// (l'empreinte de l'IP sert seulement à limiter les envois, 2 jours au plus, table usage).
// Table stats (créée au premier usage) : day, e (étape), c (concours), n.
// Lecture : GET /api/stats avec l'en-tête x-admin-token (secret ADMIN_TOKEN), ou /api/stats?t=<jeton>
// dans le navigateur ; ?format=json pour les chiffres bruts. La même page liste les résultats
// déclarés et les témoignages (POST /api/result).
import { json, err, readJson } from "./account.js";
import { take, ipTag } from "./usage.js";

// Étapes envoyées par la page, dans l'ordre du parcours.
const CLIENT = ["open", "concours", "pt", "review1", "write1", "feedback1", "blanc1", "paywall", "checkout", "active", "d7", "d30", "result"];
// Étapes comptées par le serveur lui-même (plus fiables : elles ne dépendent pas du navigateur).
const SERVER = ["signup", "trial", "code", "paid_pass", "paid_mensuel"];
const LABEL = {
  open: "Première ouverture de l'appli", concours: "Concours choisi", pt: "Test de positionnement fini",
  review1: "Première fiche révisée", write1: "Premier texte écrit", feedback1: "Premier retour de Claude reçu",
  blanc1: "Premier concours blanc corrigé", paywall: "Offre affichée", checkout: "Clic vers le paiement",
  active: "Jours actifs (appareils par jour)", d7: "Revenu après 7 jours", d30: "Revenu après 30 jours", result: "Résultat du concours déclaré",
  signup: "Compte créé", trial: "Retour offert utilisé", code: "Code d'accès activé", paid_pass: "Pass session payé", paid_mensuel: "Abonnement mensuel payé",
};
const CONC = /^(capeps-l3|capeps-m2|capeps-int|capeps-3|agreg-ext|agreg-int)$/;

let ready = false;
async function ensureStats(env) {
  if (ready) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS stats (day TEXT NOT NULL, e TEXT NOT NULL, c TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, e, c))").run();
  ready = true;
}

export async function recordEvent(env, e, c = "") {
  if (!env.DB || !LABEL[e]) return;
  try {
    await ensureStats(env);
    await env.DB.prepare("INSERT INTO stats (day, e, c, n) VALUES (?, ?, ?, 1) ON CONFLICT(day, e, c) DO UPDATE SET n = n + 1")
      .bind(new Date().toISOString().slice(0, 10), e, CONC.test(c || "") ? c : "").run();
  } catch (x) { console.error("Mesure :", String(x)); }
}

async function postEvent(request, env) {
  const { body, error } = await readJson(request); if (error) return error;
  const e = body && typeof body.e === "string" ? body.e : "";
  if (!CLIENT.includes(e)) return err(400, "bad_event");
  // 300 envois par jour et par connexion : largement assez pour un vrai visiteur.
  const ip = await ipTag(request, "bristol-event");
  if (ip && await take(env, `ev:${ip}:${new Date().toISOString().slice(0, 10)}`, 1, 300, 2 * 864e5) === null) return json(200, { ok: true });
  await recordEvent(env, e, body.c);
  return json(200, { ok: true });
}

function isAdmin(request, env) {
  const t = String(env.ADMIN_TOKEN || ""), h = request.headers.get("x-admin-token") || new URL(request.url).searchParams.get("t") || "";
  if (t.length < 16 || h.length !== t.length) return false;
  let r = 0; for (let i = 0; i < t.length; i++) r |= t.charCodeAt(i) ^ h.charCodeAt(i);
  return r === 0;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

async function getStats(request, env) {
  if (!isAdmin(request, env)) return err(404, "not_found");
  await ensureStats(env);
  const day = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare("SELECT e, c, SUM(CASE WHEN day >= ? THEN n ELSE 0 END) AS w, SUM(CASE WHEN day >= ? THEN n ELSE 0 END) AS m, SUM(n) AS t FROM stats GROUP BY e, c").bind(day(6), day(29)).all();
  const tot = {};
  for (const r of results || []) {
    const o = tot[r.e] || (tot[r.e] = { w: 0, m: 0, t: 0, c: {} });
    o.w += r.w; o.m += r.m; o.t += r.t; if (r.c) o.c[r.c] = (o.c[r.c] || 0) + r.t;
  }
  if (new URL(request.url).searchParams.get("format") === "json") return json(200, { ok: true, stats: tot });
  const order = CLIENT.slice(0, 3).concat(["signup"], CLIENT.slice(3, 6), ["trial"], CLIENT.slice(6, 9), SERVER.slice(2), CLIENT.slice(9));
  const base = (tot.open || {}).t || 0;
  const rows = order.map((e) => {
    const o = tot[e] || { w: 0, m: 0, t: 0, c: {} };
    const pct = base && e !== "active" ? Math.round((100 * o.t) / base) + " %" : "";
    const by = Object.entries(o.c).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${esc(c)} ${n}`).join(", ");
    return `<tr><td>${esc(LABEL[e])}</td><td>${o.w}</td><td>${o.m}</td><td>${o.t}</td><td>${pct}</td><td class="c">${by}</td></tr>`;
  }).join("");
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Bristol EPS · parcours</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:24px;color:#2a1d17;background:#f3f3f0}table{border-collapse:collapse;width:100%;max-width:980px;background:#fff}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #ddd;vertical-align:top}th{background:#e5e1d8}td:nth-child(n+2):nth-child(-n+5){text-align:right;font-variant-numeric:tabular-nums}.c{color:#66574d;font-size:13px}p{max-width:72ch;color:#66574d}h2{margin-top:32px}ul{max-width:80ch;padding-left:20px}li{margin:0 0 12px}</style></head><body>
<h1>Parcours des candidats</h1><p>Compteurs anonymes, sans cookie ni identifiant. Chaque appareil compte une seule fois par étape (sauf les jours actifs). « % » : part des appareils qui ont ouvert l'appli.</p>
<table><thead><tr><th>Étape</th><th>7 jours</th><th>30 jours</th><th>Total</th><th>%</th><th>Par concours (total)</th></tr></thead><tbody>${rows}</tbody></table>
${await resultsHTML(env)}</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

// Résultat du concours déclaré par le candidat après les écrits, avec un témoignage facultatif.
// Anonyme : ni compte ni adresse ; le prénom et la publication ne sont gardés que si la personne les donne.
// Table results : created_at, c, y (session), r (admissible, admis, non), txt, pub (accord de publication), prenom.
const RES = ["admissible", "admis", "non"];
let readyRes = false;
async function ensureResults(env) {
  if (readyRes) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS results (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, c TEXT NOT NULL, y INTEGER NOT NULL, r TEXT NOT NULL, txt TEXT NOT NULL DEFAULT '', pub INTEGER NOT NULL DEFAULT 0, prenom TEXT NOT NULL DEFAULT '')").run();
  readyRes = true;
}
async function postResult(request, env) {
  const { body, error } = await readJson(request); if (error) return error;
  const c = body && CONC.test(body.c || "") ? body.c : "";
  const r = body && RES.includes(body.r) ? body.r : "";
  const y = body && Number.isInteger(body.y) && body.y >= 2025 && body.y <= 2100 ? body.y : 0;
  if (!c || !r || !y) return err(400, "bad_request");
  const txt = typeof body.txt === "string" ? body.txt.trim().slice(0, 1200) : "";
  const prenom = typeof body.prenom === "string" ? body.prenom.trim().slice(0, 40) : "";
  const pub = body.pub === true && !!txt ? 1 : 0;
  const ip = await ipTag(request, "bristol-result");
  if (ip && await take(env, `res:${ip}:${new Date().toISOString().slice(0, 10)}`, 1, 5, 2 * 864e5) === null) return err(429, "too_many");
  await ensureResults(env);
  await env.DB.prepare("INSERT INTO results (created_at, c, y, r, txt, pub, prenom) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(Date.now(), c, y, r, txt, pub, pub ? prenom : "").run();
  await recordEvent(env, "result", c);
  return json(200, { ok: true });
}
async function resultsHTML(env) {
  await ensureResults(env);
  const { results: by } = await env.DB.prepare("SELECT y, c, r, COUNT(*) AS n FROM results GROUP BY y, c, r ORDER BY y DESC, c").all();
  const { results: tx } = await env.DB.prepare("SELECT created_at, c, y, r, txt, pub, prenom FROM results WHERE txt != '' ORDER BY created_at DESC LIMIT 200").all();
  if (!(by || []).length) return "<h2>Résultats déclarés</h2><p>Aucun pour l'instant.</p>";
  const rows = by.map((x) => `<tr><td>${x.y}</td><td>${esc(x.c)}</td><td>${esc(x.r)}</td><td>${x.n}</td></tr>`).join("");
  const quotes = (tx || []).map((x) => `<li><b>${esc(x.c)} ${x.y}, ${esc(x.r)}</b>${x.pub ? ` · publication acceptée${x.prenom ? ", signé " + esc(x.prenom) : ""}` : " · <i>privé</i>"}<br>${esc(x.txt)}</li>`).join("");
  return `<h2>Résultats déclarés</h2><table><thead><tr><th>Session</th><th>Concours</th><th>Résultat</th><th>Nombre</th></tr></thead><tbody>${rows}</tbody></table>${quotes ? `<h2>Témoignages</h2><ul>${quotes}</ul>` : ""}`;
}

export async function handleEvent(request, env, pathname) {
  if (!env.DB) return err(500, "accounts_not_configured");
  try {
    if (pathname === "/api/event" && request.method === "POST") return await postEvent(request, env);
    if (pathname === "/api/stats" && request.method === "GET") return await getStats(request, env);
    if (pathname === "/api/result" && request.method === "POST") return await postResult(request, env);
  } catch (e) { console.error("Mesure :", String(e && e.stack || e)); return err(500, "server_error"); }
  return err(405, "method_not_allowed");
}

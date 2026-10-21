// Bristol EPS — mesure d'audience anonyme, sans cookie.
// Le navigateur envoie au plus une fois chaque étape du parcours (première ouverture, première
// fiche, premier retour de Claude, retour après 7 et 30 jours…) ; le serveur n'ajoute que +1 à un
// compteur du jour, par étape et par concours. Aucun identifiant, aucune adresse IP n'est stocké
// (l'empreinte de l'IP sert seulement à limiter les envois, 2 jours au plus, table usage).
// Table stats (créée au premier usage) : day, e (étape), c (concours), n.
// Lecture : GET /api/stats avec l'en-tête x-admin-token (secret ADMIN_TOKEN), ou /api/stats?t=<jeton>
// dans le navigateur ; ?format=json pour les chiffres bruts. La même page liste les résultats
// déclarés et les témoignages (POST /api/result).
// Visites : le Worker appelle recordView pour chaque page servie (table views, voir plus bas).
import { json, err, readJson } from "./account.js";
import { take, ipTag } from "./usage.js";

// Étapes envoyées par la page, dans l'ordre du parcours.
const CLIENT = ["open", "concours", "pt", "review1", "write1", "feedback1", "blanc1", "paywall", "checkout", "active", "d7", "d30", "result"];
// Étapes comptées par le serveur lui-même (plus fiables : elles ne dépendent pas du navigateur).
const SERVER = ["signup", "trial", "code", "paid_pass", "paid_mensuel", "paid_recharge", "no_credits", "paused", "trial_closed", "refusal"];
const LABEL = {
  open: "Première ouverture de l'appli", concours: "Concours choisi", pt: "Test de positionnement fini",
  review1: "Première fiche révisée", write1: "Premier texte écrit", feedback1: "Premier retour de Claude reçu",
  blanc1: "Premier concours blanc corrigé", paywall: "Offre affichée", checkout: "Clic vers le paiement",
  active: "Jours actifs (appareils par jour)", d7: "Revenu après 7 jours", d30: "Revenu après 30 jours", result: "Résultat du concours déclaré",
  signup: "Compte créé", trial: "Retour offert utilisé", code: "Code d'accès activé", paid_pass: "Pass session payé", paid_mensuel: "Abonnement mensuel payé",
  paid_recharge: "Recharge de crédits payée", no_credits: "Demande refusée faute de crédits",
  paused: "Retour refusé : plafond de dépense du jour atteint", trial_closed: "Retour offert refusé : limite du jour atteinte", refusal: "Retour arrêté par le filtre de Claude (crédits rendus)",
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

// Provenance déclarée par la page (utm_source de l'annonce, gardé dans l'onglet) ou par le paiement
// (metadata Stripe) : un compteur de plus, table views, dimension « via:<source> », valeur = l'étape.
// On voit ainsi combien d'appareils venus d'une annonce ont ouvert l'appli, demandé un retour, payé.
const VIA = ["open", "feedback1", "paywall", "checkout", "paid_pass", "paid_mensuel"];
export function cleanSource(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 30); }
export async function recordSource(env, e, s) {
  const src = cleanSource(s);
  if (!env.DB || !src || !VIA.includes(e)) return;
  try {
    await ensureViews(env);
    await env.DB.prepare("INSERT INTO views (day, k, v, n) VALUES (?, ?, ?, 1) ON CONFLICT(day, k, v) DO UPDATE SET n = n + 1")
      .bind(new Date().toISOString().slice(0, 10), "via:" + src, e).run();
  } catch (x) { console.error("Provenance :", String(x)); }
}

// Visites des pages, comptées par le Worker au moment où il sert la page (ni script ni cookie).
// Table views (créée au premier usage) : day, k (dimension), v (valeur), n. Les pages vues sont
// comptées à chaque affichage ; la provenance, l'appareil et le pays une fois par visiteur et par jour.
// « Visiteur du jour » : empreinte de l'IP et du navigateur salée par la date, gardée 2 jours au plus
// dans la table usage (comme les limites d'envoi), jamais en clair ni d'un jour sur l'autre.
const PAGES = { "/": "Page d'accueil", "/app/": "Appli", "/cgv/": "CGV", "/mentions-legales/": "Mentions légales", "/confidentialite/": "Confidentialité",
  "/capeps-externe/": "CAPEPS externe", "/capeps-externe-master/": "CAPEPS transitoire", "/capeps-interne/": "CAPEPS interne",
  "/troisieme-concours-capeps/": "3e concours", "/agregation-externe-eps/": "Agrég externe", "/agregation-interne-eps/": "Agrég interne" };
const BOT = /bot|crawl|spider|slurp|archiver|facebookexternalhit|embedly|preview|headless|lighthouse|pagespeed|monitor|uptime|curl|wget|python|go-http|java\/|node-fetch|axios|okhttp|scrapy/i;
const SRC = [[/^mail\.google\.com$|^com\.google\.android\.gm$/, "Gmail"], [/(^|\.)google\.|googlequicksearchbox/, "Google"], [/(^|\.)bing\.com$/, "Bing"], [/duckduckgo\.com$/, "DuckDuckGo"], [/(^|\.)qwant\.com$/, "Qwant"], [/ecosia\.org$/, "Ecosia"], [/yahoo\./, "Yahoo"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, "Facebook"], [/instagram\.com$/, "Instagram"], [/linkedin\.com$|^lnkd\.in$/, "LinkedIn"], [/^t\.co$|(^|\.)(x|twitter)\.com$/, "X (Twitter)"],
  [/tiktok\.com$/, "TikTok"], [/youtube\.com$|^youtu\.be$/, "YouTube"], [/whatsapp\.com$/, "WhatsApp"], [/snapchat\.com$/, "Snapchat"], [/discord(app)?\.com$/, "Discord"],
  [/chatgpt\.com$|openai\.com$/, "ChatGPT"], [/perplexity\.ai$/, "Perplexity"], [/claude\.ai$/, "Claude"], [/outlook\.|live\.com$/, "Outlook"]];
let readyViews = false;
async function ensureViews(env) {
  if (readyViews) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS views (day TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, k, v))").run();
  readyViews = true;
}
export function viewPage(pathname) {
  const p = pathname.replace(/index\.html$/, "").replace(/([^/])$/, "$1/");
  return PAGES[p] ? p : "";
}
function source(request, url) {
  const utm = (url.searchParams.get("utm_source") || url.searchParams.get("ref") || "").toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 30);
  if (utm) return utm;
  let h = "";
  try { h = new URL(request.headers.get("referer") || "").hostname.toLowerCase(); } catch (e) { return "Direct"; }
  if (h === url.hostname || h.endsWith("eps-bristol.fr") || h.endsWith(".workers.dev")) return "";
  for (const [re, name] of SRC) if (re.test(h)) return name;
  return h.replace(/^(www|m|l|lm)\./, "").slice(0, 60) || "Direct";
}
// Appelée par worker.js (ctx.waitUntil) pour une page servie en GET ; ne bloque jamais la réponse.
export async function recordView(request, env, url) {
  const page = viewPage(url.pathname), ua = request.headers.get("user-agent") || "";
  if (!env.DB || !page || !ua || BOT.test(ua) || /prefetch|prerender/.test(request.headers.get("sec-purpose") || request.headers.get("purpose") || "")) return;
  try {
    const day = new Date().toISOString().slice(0, 10), inc = [["page", page]];
    const tag = await ipTag(request, "bristol-uv|" + day + "|" + ua);
    if (tag && await take(env, `uv:${tag}`, 1, 1e9, 2 * 864e5) === 1) {
      const src = source(request, url);
      inc.push(["uv", ""], ["src", src || "Direct"], ["dev", /iPad|Tablet/i.test(ua) ? "Tablette" : /Mobi|Android|iPhone/i.test(ua) ? "Téléphone" : "Ordinateur"]);
      const cc = String((request.cf && request.cf.country) || "").toUpperCase();
      inc.push(["cc", /^[A-Z]{2}$/.test(cc) && cc !== "XX" && cc !== "T1" ? cc : "?"]);
    }
    await ensureViews(env);
    const st = env.DB.prepare("INSERT INTO views (day, k, v, n) VALUES (?, ?, ?, 1) ON CONFLICT(day, k, v) DO UPDATE SET n = n + 1");
    await env.DB.batch(inc.map(([k, v]) => st.bind(day, k, v)));
  } catch (x) { console.error("Visites :", String(x)); }
}

async function postEvent(request, env) {
  const { body, error } = await readJson(request); if (error) return error;
  const e = body && typeof body.e === "string" ? body.e : "";
  if (!CLIENT.includes(e)) return err(400, "bad_event");
  // 300 envois par jour et par connexion : largement assez pour un vrai visiteur.
  const ip = await ipTag(request, "bristol-event");
  if (ip && await take(env, `ev:${ip}:${new Date().toISOString().slice(0, 10)}`, 1, 300, 2 * 864e5) === null) return json(200, { ok: true });
  await recordEvent(env, e, body.c);
  if (body.s) await recordSource(env, e, body.s);
  return json(200, { ok: true });
}

// Parcours des visiteurs arrivés avec une provenance (?utm_source=…), sur la période choisie.
function viaHTML(via, per) {
  const src = Object.keys(via).sort((a, b) => (via[b].open || 0) - (via[a].open || 0));
  const head = `<h2>Parcours par provenance</h2><p>Visiteurs arrivés par un lien marqué (?utm_source=…, par exemple google-ads), sur ${per}. Les achats sont comptés au paiement.</p>`;
  if (!src.length) return head + "<p class=\"mut\">Aucun pour l'instant.</p>";
  const rows = src.map((s) => `<tr><td>${esc(s)}</td>${VIA.map((e) => `<td>${via[s][e] || 0}</td>`).join("")}</tr>`).join("");
  return head + `<div class="card scroll"><table class="funnel"><thead><tr><th>Provenance</th>${VIA.map((e) => `<th>${esc(LABEL[e])}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function isAdmin(request, env) {
  const t = String(env.ADMIN_TOKEN || ""), h = request.headers.get("x-admin-token") || new URL(request.url).searchParams.get("t") || "";
  if (t.length < 16 || h.length !== t.length) return false;
  let r = 0; for (let i = 0; i < t.length; i++) r |= t.charCodeAt(i) ^ h.charCodeAt(i);
  return r === 0;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

const pctOf = (a, b) => (b ? Math.round((100 * a) / b) : 0);
function delta(cur, prev) {
  if (!prev) return cur ? `<span class="up">nouveau</span>` : "";
  const d = Math.round((100 * (cur - prev)) / prev);
  return `<span class="${d >= 0 ? "up" : "down"}">${d >= 0 ? "+" : ""}${d} %</span> <span class="mut">vs ${prev}</span>`;
}
let regions = null;
function country(cc) {
  if (cc === "?") return "Inconnu";
  try { regions = regions || new Intl.DisplayNames(["fr"], { type: "region" }); return regions.of(cc) || cc; } catch (e) { return cc; }
}
// Tableau « valeur, nombre, part » avec une barre proportionnelle.
function share(title, m, name = (v) => v, max = 12) {
  const all = Object.entries(m).sort((a, b) => b[1] - a[1]), tot = all.reduce((t, [, n]) => t + n, 0);
  if (!tot) return `<section class="card"><h3>${title}</h3><p class="mut">Rien pour l'instant.</p></section>`;
  const top = all.slice(0, max), rest = all.slice(max).reduce((t, [, n]) => t + n, 0);
  if (rest) top.push(["Autres", rest]);
  const rows = top.map(([v, n]) => `<tr><td><span class="bar" style="width:${pctOf(n, top[0][1])}%"></span><span class="lbl">${esc(v === "Autres" ? v : name(v))}</span></td><td>${n}</td><td class="mut">${pctOf(n, tot)} %</td></tr>`).join("");
  return `<section class="card"><h3>${title}</h3><table class="sh"><tbody>${rows}</tbody></table></section>`;
}
// Histogramme des visiteurs par jour (SVG, infobulle native au survol, sans script).
function chart(days, uv, pv) {
  const W = 960, H = 240, L = 34, top = 16, bot = 28, n = days.length, max = Math.max(4, ...days.map((d) => uv[d] || 0));
  const bw = (W - L) / n, step = Math.pow(10, Math.floor(Math.log10(max))), tick = max / step > 5 ? step * 2 : step >= 1 ? step : 1;
  const y = (v) => top + (H - top - bot) * (1 - v / max), fd = (d) => d.slice(8, 10) + "/" + d.slice(5, 7);
  let g = "";
  for (let v = 0; v <= max; v += Math.max(1, tick)) g += `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${v}</text>`;
  const bars = days.map((d, i) => { const v = uv[d] || 0, x = L + i * bw + Math.max(1, bw * 0.15), w = Math.max(1, bw * 0.7);
    return `<rect x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${w.toFixed(1)}" height="${(H - bot - y(v)).toFixed(1)}" rx="${Math.min(3, w / 2).toFixed(1)}" class="b"><title>${fd(d)} : ${v} visiteur${v > 1 ? "s" : ""}, ${pv[d] || 0} page${(pv[d] || 0) > 1 ? "s" : ""} vue${(pv[d] || 0) > 1 ? "s" : ""}</title></rect>`; }).join("");
  const lab = [0, Math.floor((n - 1) / 2), n - 1].map((i) => `<text x="${(L + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}" class="ax">${fd(days[i])}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Visiteurs par jour">${g}${bars}${lab}</svg>`;
}

async function getStats(request, env) {
  if (!isAdmin(request, env)) return err(404, "not_found");
  await ensureStats(env); await ensureViews(env);
  const url = new URL(request.url), J = [7, 30, 90, 365].includes(+url.searchParams.get("j")) ? +url.searchParams.get("j") : 30;
  const day = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare("SELECT e, c, SUM(CASE WHEN day >= ? THEN n ELSE 0 END) AS w, SUM(CASE WHEN day >= ? THEN n ELSE 0 END) AS m, SUM(CASE WHEN day >= ? THEN n ELSE 0 END) AS p, SUM(n) AS t FROM stats GROUP BY e, c").bind(day(6), day(29), day(J - 1)).all();
  const tot = {};
  for (const r of results || []) {
    const o = tot[r.e] || (tot[r.e] = { w: 0, m: 0, p: 0, t: 0, c: {} });
    o.w += r.w; o.m += r.m; o.p += r.p; o.t += r.t; if (r.c) o.c[r.c] = (o.c[r.c] || 0) + r.t;
  }
  // Visites : la période choisie et la précédente (pour la comparaison).
  const { results: vr } = await env.DB.prepare("SELECT day, k, v, n FROM views WHERE day >= ?").bind(day(2 * J - 1)).all();
  const from = day(J - 1), V = { uv: {}, pv: {}, page: {}, src: {}, dev: {}, cc: {} }, P = { uv: 0, pv: 0 }, via = {};
  for (const r of vr || []) {
    const cur = r.day >= from;
    if (r.k.startsWith("via:")) { if (cur) { const o = via[r.k.slice(4)] || (via[r.k.slice(4)] = {}); o[r.v] = (o[r.v] || 0) + r.n; } continue; }
    if (r.k === "uv" || r.k === "page") { const key = r.k === "uv" ? "uv" : "pv"; if (cur) V[key][r.day] = (V[key][r.day] || 0) + r.n; else P[key] += r.n; }
    if (cur && V[r.k] && r.k !== "uv") V[r.k][r.v] = (V[r.k][r.v] || 0) + r.n;
  }
  const sum = (m) => Object.values(m).reduce((a, b) => a + b, 0), uv = sum(V.uv), pv = sum(V.pv);
  if (url.searchParams.get("format") === "json") return json(200, { ok: true, stats: tot, visits: { days: J, visitors: uv, pageviews: pv, previous: P, byDay: V.uv, pages: V.page, sources: V.src, devices: V.dev, countries: V.cc }, via });
  const days = Array.from({ length: J }, (_, i) => day(J - 1 - i));
  const tp = (e) => (tot[e] || {}).p || 0, paid = tp("paid_pass") + tp("paid_mensuel") + tp("paid_recharge");
  const kpi = (lab, val, sub = "") => `<div class="kpi"><div class="k">${lab}</div><div class="v">${val}</div><div class="s">${sub}</div></div>`;
  const per = J === 7 ? "7 jours" : J === 30 ? "30 jours" : J === 90 ? "90 jours" : "12 mois";
  const nav = [7, 30, 90, 365].map((j) => j === J ? `<b>${j === 365 ? "12 mois" : j + " j"}</b>` : `<a href="?t=${encodeURIComponent(url.searchParams.get("t") || "")}&amp;j=${j}">${j === 365 ? "12 mois" : j + " j"}</a>`).join("");
  const order = CLIENT.slice(0, 3).concat(["signup"], CLIENT.slice(3, 6), ["trial"], CLIENT.slice(6, 9), SERVER.slice(2), CLIENT.slice(9));
  const base = (tot.open || {}).t || 0;
  const rows = order.map((e) => {
    const o = tot[e] || { w: 0, m: 0, t: 0, c: {} };
    const pct = base && e !== "active" ? Math.round((100 * o.t) / base) + " %" : "";
    const by = Object.entries(o.c).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${esc(c)} ${n}`).join(", ");
    return `<tr><td>${esc(LABEL[e])}</td><td>${o.w}</td><td>${o.m}</td><td>${o.t}</td><td>${pct}</td><td class="c">${by}</td></tr>`;
  }).join("");
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Bristol EPS · tableau de bord</title>
<style>:root{--ink:#2a1d17;--mut:#66574d;--bg:#f3f3f0;--card:#fff;--line:#e2ddd3;--head:#efebe3;--acc:#2f6f5e;--accs:#d9ebe5;--up:#2f7a3d;--down:#b3412e}
@media (prefers-color-scheme:dark){:root{--ink:#ece6df;--mut:#a89c90;--bg:#1b1916;--card:#25221e;--line:#3a352f;--head:#2e2a25;--acc:#6cc3a8;--accs:#2c4a41;--up:#7fd08d;--down:#f08a76}}
*{box-sizing:border-box}body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px 16px 48px;color:var(--ink);background:var(--bg)}main{max-width:1040px;margin:0 auto}
h1{margin:0 0 4px;font-size:24px}h2{margin:36px 0 12px;font-size:19px}h3{margin:0 0 10px;font-size:15px}p{max-width:75ch;color:var(--mut);margin:0 0 12px}.mut{color:var(--mut)}
.nav{display:flex;gap:6px;margin:12px 0 20px;flex-wrap:wrap}.nav a,.nav b{padding:4px 12px;border-radius:999px;border:1px solid var(--line);text-decoration:none;color:var(--ink);font-size:14px}.nav b{background:var(--acc);border-color:var(--acc);color:var(--bg)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.kpi,.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.kpi .k{color:var(--mut);font-size:13px}.kpi .v{font-size:28px;font-weight:650;font-variant-numeric:tabular-nums;line-height:1.2;margin:2px 0}.kpi .s{font-size:12.5px;min-height:1em}.up{color:var(--up)}.down{color:var(--down)}
.card+.card{margin-top:0}.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-top:12px}.chart{margin-top:12px}svg{width:100%;height:auto;display:block}
svg .b{fill:var(--acc)}svg .b:hover{opacity:.75}svg .grid{stroke:var(--line);stroke-width:1}svg .ax{fill:var(--mut);font-size:13px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{background:var(--head);font-weight:600}
td:nth-child(n+2){font-variant-numeric:tabular-nums}.sh td:nth-child(n+2){text-align:right;width:1%;white-space:nowrap}.sh td:first-child{position:relative}.sh .bar{position:absolute;left:0;top:4px;bottom:4px;background:var(--accs);border-radius:4px}.sh .lbl{position:relative;padding-left:6px}
.funnel td:nth-child(n+2):nth-child(-n+5){text-align:right}.c{color:var(--mut);font-size:13px}.scroll{overflow-x:auto}ul{max-width:80ch;padding-left:20px}li{margin:0 0 12px}</style></head><body><main>
<h1>Tableau de bord</h1><p>Visites et parcours sur eps-bristol.fr. Mesure sans cookie ni identifiant ; robots et préchargements exclus. Un visiteur est compté une fois par jour : la même personne revenue trois jours compte trois fois.</p>
<nav class="nav" aria-label="Période">${nav}</nav>
<div class="kpis">${kpi("Visiteurs · " + per, uv, delta(uv, P.uv))}${kpi("Pages vues · " + per, pv, delta(pv, P.pv))}${kpi("Visiteurs aujourd'hui", V.uv[day(0)] || 0, `hier ${V.uv[day(1)] || 0}`)}${kpi("Ont ouvert l'appli", tp("open"), uv ? `${pctOf(tp("open"), uv)} % des visiteurs` : "")}${kpi("Comptes créés", tp("signup"), tp("open") ? `${pctOf(tp("signup"), tp("open"))} % des ouvertures` : "")}${kpi("Paiements", paid, tp("checkout") ? `${tp("checkout")} clics vers le paiement` : "")}</div>
<section class="card chart"><h3>Visiteurs par jour</h3>${chart(days, V.uv, V.pv)}</section>
<div class="grid2">${share("Provenance", V.src)}${share("Pages vues", V.page, (p) => PAGES[p] || p)}${share("Appareils", V.dev)}${share("Pays", V.cc, country, 8)}</div>
<h2>Parcours des candidats</h2><p>Chaque appareil compte une seule fois par étape (sauf les jours actifs). « % » : part des appareils qui ont ouvert l'appli.</p>
<div class="card scroll"><table class="funnel"><thead><tr><th>Étape</th><th>7 jours</th><th>30 jours</th><th>Total</th><th>%</th><th>Par concours (total)</th></tr></thead><tbody>${rows}</tbody></table></div>
${viaHTML(via, per)}
${await resultsHTML(env)}</main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" } });
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
  return `<h2>Résultats déclarés</h2><div class="card"><table><thead><tr><th>Session</th><th>Concours</th><th>Résultat</th><th>Nombre</th></tr></thead><tbody>${rows}</tbody></table></div>${quotes ? `<h2>Témoignages</h2><ul>${quotes}</ul>` : ""}`;
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

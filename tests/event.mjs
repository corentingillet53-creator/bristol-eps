// Serveur : mesure d'audience anonyme (/api/event, /api/stats) et résultats déclarés (/api/result).
import { handleEvent, recordEvent } from "../functions/api/event.js";
import { makeD1 } from "./d1mock.mjs";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const DB = makeD1(), env = { DB, ADMIN_TOKEN: "jeton-admin-assez-long" };
const q = (sql, ...a) => DB.sqlite.prepare(sql).get(...a);
const post = (path, body, ip = "1.1.1.1") => handleEvent(new Request("https://x.dev" + path, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify(body) }), env, path);
const get = (qs = "", h = {}) => handleEvent(new Request("https://x.dev/api/stats" + qs, { headers: h }), env, "/api/stats");

ok((await post("/api/event", { e: "open", c: "capeps-int" })).status === 200, "étape connue acceptée");
await post("/api/event", { e: "open", c: "capeps-int" }, "2.2.2.2");
await post("/api/event", { e: "review1", c: "pas-un-concours" });
ok((await post("/api/event", { e: "signup" })).status === 400, "étape serveur refusée depuis le navigateur");
ok((await post("/api/event", { e: "nimporte" })).status === 400, "étape inconnue refusée");
ok(q("SELECT n FROM stats WHERE e = 'open' AND c = 'capeps-int'").n === 2, "compteur du jour : +1 par envoi");
ok(q("SELECT c FROM stats WHERE e = 'review1'").c === "", "concours inconnu ramené à vide");
ok(q("SELECT COUNT(*) AS n FROM sqlite_master WHERE sql LIKE '%ip%' AND name = 'stats'").n === 0, "aucune colonne d'adresse ni d'identifiant");
for (let i = 0; i < 305; i++) await post("/api/event", { e: "active" }, "3.3.3.3");
ok(q("SELECT n FROM stats WHERE e = 'active'").n === 300, "300 envois par jour et par connexion au plus");
await recordEvent(env, "signup"); await recordEvent(env, "paid_pass", "agreg-int");
ok((await get()).status === 404 && (await get("?t=faux-jeton-de-meme-taille")).status === 404, "tableau réservé au jeton");
const html = await (await get("?t=jeton-admin-assez-long")).text();
ok(/Première ouverture de l'appli<\/td><td>2<\/td>/.test(html) && /Pass session payé/.test(html) && /capeps-int 2/.test(html), "tableau lisible avec le jeton");
const js = await (await get("?format=json", { "x-admin-token": "jeton-admin-assez-long" })).json();
ok(js.stats.open.t === 2 && js.stats.signup.t === 1, "chiffres bruts en JSON");
ok((await post("/api/result", { c: "capeps-int", y: 2027, r: "admissible", txt: "Les retours sur mes plans m'ont fait progresser.", pub: true, prenom: "Léa" })).status === 200, "résultat avec témoignage public");
ok((await post("/api/result", { c: "agreg-int", y: 2027, r: "non", txt: "Privé", pub: false, prenom: "Paul" })).status === 200, "résultat avec témoignage privé");
ok((await post("/api/result", { c: "agreg-int", y: 2027, r: "peut-être" })).status === 400, "résultat inconnu refusé");
ok(q("SELECT prenom FROM results WHERE r = 'non'").prenom === "", "prénom non gardé sans accord de publication");
ok(q("SELECT n FROM stats WHERE e = 'result' AND c = 'capeps-int'").n === 1, "résultat compté dans le parcours");
const h2 = await (await get("?t=jeton-admin-assez-long")).text();
ok(/Résultats déclarés/.test(h2) && /signé Léa/.test(h2) && /<i>privé<\/i>/.test(h2), "résultats et témoignages dans le tableau");
let st = 0; for (let i = 0; i < 6; i++) st = (await post("/api/result", { c: "capeps-l3", y: 2027, r: "admis" }, "9.9.9.9")).status;
ok(st === 429, "5 résultats par jour et par connexion au plus");

// Visites des pages (recordView, appelée par le Worker pour chaque page servie).
import { recordView, viewPage } from "../functions/api/event.js";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1", PC = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36";
const view = (path, { ip = "5.5.5.5", ua = UA, ref = "", cc = "FR", h = {} } = {}) => {
  const r = new Request("https://eps-bristol.fr" + path, { headers: { "cf-connecting-ip": ip, "user-agent": ua, ...(ref ? { referer: ref } : {}), ...h } });
  Object.defineProperty(r, "cf", { value: { country: cc } });
  return recordView(r, env, new URL(r.url));
};
const vn = (k, v) => (q("SELECT SUM(n) AS n FROM views WHERE k = ? AND v = ?", k, v) || {}).n || 0;
ok(viewPage("/") === "/" && viewPage("/app") === "/app/" && viewPage("/app/index.html") === "/app/" && viewPage("/robots.txt") === "" && viewPage("/wp-admin/") === "", "pages reconnues");
ok(["capeps-externe", "capeps-externe-master", "capeps-interne", "troisieme-concours-capeps", "agregation-externe-eps", "agregation-interne-eps"].every(p => viewPage("/" + p + "/") === "/" + p + "/"), "pages des concours reconnues");
await view("/", { ref: "https://www.google.fr/" });
await view("/app/", { ref: "https://eps-bristol.fr/" });
await view("/", { ip: "6.6.6.6", ua: PC, ref: "https://www.facebook.com/" , cc: "BE" });
await view("/?utm_source=Newsletter-Oct", { ip: "7.7.7.7", ua: PC });
await view("/", { ip: "8.8.8.8", ua: PC, ref: "android-app://com.google.android.gm/" });
await view("/", { ip: "9.9.9.1", ua: "Googlebot/2.1 (+http://www.google.com/bot.html)" });
await view("/", { ip: "9.9.9.2", h: { "sec-purpose": "prefetch" } });
await view("/robots.txt", { ip: "9.9.9.3" });
ok(vn("page", "/") === 4 && vn("page", "/app/") === 1, "pages vues : chaque affichage, robots et préchargements exclus");
ok(vn("uv", "") === 4, "visiteurs : une fois par jour, même en changeant de page");
ok(vn("src", "Google") === 1 && vn("src", "Facebook") === 1 && vn("src", "newsletter-oct") === 1 && vn("src", "Gmail") === 1 && vn("src", "eps-bristol.fr") === 0, "provenance regroupée, navigation interne ignorée, utm_source pris en compte");
ok(vn("dev", "Téléphone") === 1 && vn("dev", "Ordinateur") === 3 && vn("cc", "BE") === 1, "appareil et pays");
ok(q("SELECT COUNT(*) AS n FROM usage WHERE k LIKE 'uv:%' AND k LIKE '%5.5.5.5%'").n === 0, "aucune adresse en clair");
const dash = await (await get("?t=jeton-admin-assez-long&j=7")).text();
ok(/Visiteurs · 7 jours/.test(dash) && /<svg/.test(dash) && /Provenance/.test(dash) && /Google/.test(dash) && /Belgique/.test(dash) && /Page d'accueil/.test(dash), "tableau de bord des visites");
const vj = await (await get("?format=json&j=30", { "x-admin-token": "jeton-admin-assez-long" })).json();
ok(vj.visits.visitors === 4 && vj.visits.pageviews === 5 && vj.visits.sources.Google === 1, "visites en JSON");

// Clic d'annonce sans utm_source : gclid (marquage automatique de Google Ads) compte pour google-ads.
await view("/capeps-interne/?gclid=Cj0KCQabc", { ip: "8.8.8.1", ua: PC, ref: "https://www.google.com/" });
ok(vn("src", "google-ads") === 1, "gclid compté comme google-ads");
// Provenance (utm_source gardé par la page) suivie le long du parcours, jusqu'au paiement.
import { recordSource } from "../functions/api/event.js";
await post("/api/event", { e: "paywall", c: "capeps-int", s: "Google-Ads" }, "4.4.4.1");
await post("/api/event", { e: "review1", c: "capeps-int", s: "google-ads" }, "4.4.4.1");
await recordSource(env, "paid_pass", "google-ads"); await recordSource(env, "paid_pass", "");
ok(vn("via:google-ads", "paywall") === 1 && vn("via:google-ads", "paid_pass") === 1 && vn("via:google-ads", "review1") === 0, "provenance : étapes clés comptées, nom nettoyé");
const dv = await (await get("?t=jeton-admin-assez-long")).text();
ok(/Achat par visiteur/.test(dv) && /<td>google-ads<\/td><td>1<\/td>/.test(dv) && /100,0 %/.test(dv), "tableau : visiteurs et taux d'achat par provenance");
ok(/Parcours par provenance/.test(dv) && /<td>google-ads<\/td>/.test(dv) && !/Visiteurs[^<]*via:/.test(dv), "tableau : parcours par provenance");
const jv = await (await get("?format=json", { "x-admin-token": "jeton-admin-assez-long" })).json();
ok(jv.via["google-ads"].paid_pass === 1 && !("via:google-ads" in jv.visits.sources), "provenance en JSON, à part des visites");

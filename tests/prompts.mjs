// Retours de Claude selon le concours : la page et le serveur construisent exactement le même prompt.
// Pour chaque concours, exercice et type de sujet, on capture le prompt de la page (mode Claude) et la requête
// envoyée au serveur (mode site), puis on rejoue la requête dans functions/api/feedback.js.
// Prérequis : node server.js (port 8766). Usage : node prompts.mjs → « ALL OK ».
import { chromium } from "playwright";
import { onRequestPost } from "../functions/api/feedback.js";

let upstream = null;
globalThis.fetch = async (url, init) => {
  upstream = JSON.parse(init.body);
  const enc = new TextEncoder();
  const body = new ReadableStream({ start(c) { c.enqueue(enc.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n')); c.close(); } });
  return new Response(body, { status: 200 });
};
const env = { ANTHROPIC_API_KEY: "k", ACCESS_CODES: "test" };
async function serverPrompt(payload) {
  upstream = null;
  const res = await onRequestPost({ request: new Request("https://x.dev/api/feedback", { method: "POST", headers: { "content-type": "application/json", "x-access-code": "test" }, body: JSON.stringify(payload) }), env });
  await res.text();
  if (!upstream) return { status: res.status };
  const c = upstream.messages[0].content;
  return { status: res.status, prompt: typeof c === "string" ? c : c[c.length - 1].text };
}
const fails = [];
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) fails.push(m); };

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
async function page(conc) {
  const ctx = await b.newContext();
  await ctx.addInitScript(c => { if (!localStorage.getItem("x")) { localStorage.setItem("x", "1"); localStorage.setItem("bristol-eps-v1", JSON.stringify({ prefs: { concours: c } })); localStorage.setItem("bristol-eps-welcome", "1"); localStorage.setItem("bristol-eps-plan", JSON.stringify({ active: true, plan: "code" })); } }, conc);
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.goto("http://localhost:8766/app/"); await p.waitForTimeout(500);
  await p.evaluate(() => { window.__cap = []; sampleFn = async (prompt, opts) => { window.__cap.push({ prompt, payload: opts.payload }); return { text: "## Ce qui fonctionne\n- ok" }; }; });
  return { ctx, p, errs };
}
const NOTES = "Introduction. La citation pose une relation entre l'évaluation et l'autonomie des élèves ; je la discute à partir du contexte du collège et de la classe de 5e. ".repeat(3);
const CASES = [
  ["capeps-int", "ei", ["intro", "para", "plan"], /étude de cas/, /volet/i],
  ["agreg-int", "e1", ["intro", "para", "plan"], /première épreuve écrite de l'agrégation interne/, /citation/],
  ["agreg-int", "e2", ["intro", "para", "plan"], /seconde épreuve écrite de l'agrégation interne/, /classe/],
  ["agreg-ext", "e1", ["intro", "para", "plan"], /première épreuve écrite de l'agrégation externe/, /écrit|document/],
  ["agreg-ext", "e2", ["intro", "para", "plan"], /seconde épreuve écrite de l'agrégation externe/, /thèse/],
  ["capeps-m2", "e2", ["intro", "para", "plan"], /épreuve écrite 2 du CAPEPS externe/, /épisodes/]
];
for (const [conc, e, kinds, who, word] of CASES) {
  const { ctx, p, errs } = await page(conc);
  for (const kind of kinds) {
    const r = await p.evaluate(([e, kind, notes]) => {
      const fam = { "capeps-int": "cint", "agreg-int": "aint", "agreg-ext": "aext", "capeps-m2": "cext" }[prefs.concours];
      const a = ANNALES.filter(x => x.f === fam && x.e === e).sort((x, y) => y.y - x.y)[0];
      const s = annSubject(a); sj.cur = s; sj.epr = s.epr; sj.mode = kind; sj.shown = false;
      noteSet(fbKey(s, kind), notes); noteSet("d:" + s.id, "Collège REP de 800 élèves, classe de 5e de 26 élèves, équipe de 4 enseignants.");
      window.__cap = []; setView("sujets");
      return askFeedback(kind).then(() => ({ cap: window.__cap[0], id: s.id, html: document.getElementById("panel-sujets").innerHTML }));
    }, [e, kind, NOTES]);
    const tag = `${conc} ${e} ${kind}`;
    ok(r.cap && who.test(r.cap.prompt), tag + " : bonne épreuve dans le prompt");
    ok(r.cap && word.test(r.cap.prompt), tag + " : vocabulaire du concours");
    ok(r.cap && !/le candidat les a sous les yeux/.test(r.cap.prompt), tag + " : plus de dossier supposé connu");
    ok(r.cap && r.cap.payload && r.cap.payload.jsuj && r.cap.payload.jsuj.length > 0, tag + " : notes du jury sur ce sujet transmises");
    const srv = await serverPrompt(r.cap.payload);
    ok(srv.status === 200 && srv.prompt === r.cap.prompt, tag + " : prompt identique page et serveur" + (srv.prompt === r.cap.prompt ? "" : diff(r.cap.prompt, srv.prompt || String(srv.status))));
    if (e === "ei" || (conc === "agreg-int" && e === "e2")) ok(/Collège REP de 800 élèves/.test(r.cap.prompt) && /data-dos=/.test(r.html), tag + " : dossier du sujet saisi et transmis");
    if (conc === "agreg-ext" && e === "e2") ok(!/data-dos=/.test(r.html) && !/contexte d'établissement et d'épisodes/.test(r.cap.prompt.split("Un candidat")[0].replace("Il n'y a ni contexte d'établissement ni épisodes de classe.", "")), tag + " : ni dossier ni épisodes");
  }
  // concours blanc corrigé
  const c = await p.evaluate(([e]) => {
    const fam = FAM[prefs.concours], a = ANNALES.filter(x => x.f === fam && x.e === e).sort((x, y) => y.y - x.y)[0];
    const now = Date.now(), m = { id: "btest", k: e, s: "Écrit", co: concById(prefs.concours).t, f: fam, src: "ann", sid: a.id, dur: 4 * 3600, start: now - 3600e3, end: now, state: "done", paper: 0 };
    blancPut(m); txSet("b:btest", "Ma copie. ".repeat(60)); window.__cap = [];
    return askCopie(m).then(() => window.__cap[0]);
  }, [e]);
  const srv = await serverPrompt(c.payload);
  ok(srv.status === 200 && srv.prompt === c.prompt, `${conc} ${e} copie : prompt identique page et serveur` + (srv.prompt === c.prompt ? "" : diff(c.prompt, srv.prompt || String(srv.status))));
  ok(who.source.includes("CAPEPS externe") || !/sciences et intervention en EPS\)/.test(c.prompt), `${conc} ${e} copie : épreuve du concours`);
  ok(!errs.length, conc + " sans erreur " + errs.join(" | "));
  await ctx.close();
}
// Test de positionnement du CAPEPS interne : textes officiels et intervention, aucun leurre hors programme
{
  const { ctx, p, errs } = await page("capeps-int");
  const r = await p.evaluate(() => { const L = []; for (let i = 0; i < 5; i++) L.push(ptBuild()); return L.map(qs => qs.map(q => { const c = byId(q.id); return { th: c.th, opts: q.opts }; })); });
  const ths = new Set(r.flat().map(q => q.th));
  ok([...ths].every(t => t === "PO" || t === "IN"), "capeps-int test : thèmes " + [...ths].join(","));
  ok(r.every(qs => qs.length >= 10), "capeps-int test : au moins 10 questions");
  const bad = r.flat().filter(q => q.opts.some(o => /VO2|filière|Schmidt|course à vitesse élevée/i.test(o)));
  ok(!bad.length, "capeps-int test : aucun leurre de sciences hors programme");
  const n = await p.evaluate(() => [concCards().length, concCards().filter(c => grpOf(c) === "e2").every(c => c.th === "IN"), eprOf("e2").t]);
  ok(n[1] && n[0] < 120, "capeps-int : paquet textes officiels + intervention (" + n[0] + " fiches)");
  ok(/justifier/.test(n[2]), "capeps-int : paquet renommé « " + n[2] + " »");
  const ac = await p.evaluate(() => annCards(ANNALES.find(a => a.f === "cint" && a.y === 2026)).map(id => grpOf(byId(id))));
  ok(ac.length && ac.every(g => g === "tx" || g === "e2"), "capeps-int : cartes utiles d'une annale hors histoire (" + ac.join(",") + ")");
  ok(!errs.length, "capeps-int test sans erreur " + errs.join(" | "));
  await ctx.close();
}
function diff(a, b) { let i = 0; while (i < a.length && a[i] === b[i]) i++; return `\n  page   : …${JSON.stringify(a.slice(Math.max(0, i - 60), i + 80))}\n  serveur: …${JSON.stringify(b.slice(Math.max(0, i - 60), i + 80))}`; }
console.log(fails.length ? "FAILS: " + fails.length : "ALL OK");
await b.close();

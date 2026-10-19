const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const fails=[];const ok=(c,m)=>{console.log(c?'ok  ':'FAIL',m);if(!c)fails.push(m)};
const mk=async(conc,prem)=>{const ctx=await b.newContext({viewport:{width:1280,height:900}});await ctx.addInitScript(([c,pr])=>{if(!localStorage.getItem('x')){localStorage.setItem('x','1');localStorage.setItem('bristol-eps-v1',JSON.stringify({prefs:{concours:c}}));localStorage.setItem('bristol-eps-welcome','1');if(pr)localStorage.setItem('bristol-eps-plan',JSON.stringify({active:true,plan:'code'}));}},[conc,prem]);const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));await p.goto('http://localhost:8766/app/');await p.waitForTimeout(600);await p.evaluate(()=>{try{hideWelcome()}catch(e){}});return {ctx,p,errs};};
// agrég externe
{const {ctx,p,errs}=await mk('agreg-ext',true);
 const s1=await p.evaluate(()=>subjectOfDay());ok(s1&&s1.annale&&!/1880/.test(s1.t),'agreg-ext sujet du jour = annale ('+(s1&&s1.id)+')');
 await p.evaluate(()=>{me.tab='e2';setView('methode')});const mt=await p.textContent('#panel-methode .sect-h');ok(/dissertation/.test(mt),'agreg-ext méthode e2 : '+mt);
 await p.evaluate(()=>{sj.epr='e1';sj.cur=null;setView('sujets')});const t=await p.textContent('#panel-sujets');ok(!/1880 et 1939/.test(t),'agreg-ext sujets sans s06');ok(/Sujets officiels de ton concours/.test(t),'agreg-ext mention sujets officiels');ok(!/Les 1 autres/.test(t),'accord attentes');
 await p.evaluate(()=>paywall('menu'));const pw=await p.textContent('#paywall');ok(!/oraux compris|trois écrits/.test(pw),'paywall sans contradictions');
 ok(!errs.length,'agreg-ext sans erreur '+errs.join('|'));await ctx.close();}
// agrég interne
{const {ctx,p,errs}=await mk('agreg-int',false);
 await p.evaluate(()=>{chooseConcours('agreg-int');setView('home')});await p.waitForTimeout(200);const hd=await p.textContent('.hero-date');ok(/vers le/.test(hd)&&/provisoire/.test(hd),'agreg-int date provisoire : '+hd.trim().slice(0,60));
 await p.evaluate(()=>{conc.cur=CONCOURS.find(c=>c.id==='agreg-int');setView('concours')});const mc=await p.textContent('#panel-concours');ok(/Ton programme 2026/.test(mc)&&/reste à relire/.test(mc),'agreg-int programme 2026 signalé');
 const qs=await p.evaluate(()=>ptBuild());const dup=qs.filter(q=>q.opts.filter(o=>/Haby/.test(o)).length>1);ok(!dup.length,'test : pas de double bonne réponse Haby');
 await p.evaluate(()=>{me.tab='e1';setView('methode')});ok(/commentaire/.test(await p.textContent('#panel-methode .sect-h')),'agreg-int méthode e1 commentaire');
 ok(!errs.length,'agreg-int sans erreur '+errs.join('|'));await ctx.close();}
// troisième concours
{const {ctx,p,errs}=await mk('capeps-3',true);
 await p.evaluate(()=>{conc.cur=CONCOURS.find(c=>c.id==='capeps-3');setView('concours')});const mc=await p.textContent('#panel-concours');ok(/Épreuves reprises/.test(mc)&&/4 h, coefficient 2/.test(mc),'capeps-3 épreuves affichées');ok(/Ne plus suivre/.test(mc),'libellé retirer');
 const eps=await p.evaluate(()=>blancEprs ? blancEprs() : null).catch(()=>null);
 const h=await p.evaluate(()=>{const c=CONCOURS.find(x=>x.id==='capeps-3');return c.adm.map(a=>(a.m.match(/(\d+) h/)||[])[1])});ok(h.join()==='4,3','capeps-3 durées 4 h / 3 h');
 // brouillon après rechargement
 await p.evaluate(()=>{const s=subjectOfDay();sj.cur=s;sj.epr='e1';sj.mode='plan';setView('sujets')});const id1=await p.evaluate(()=>sj.cur.id);
 await p.reload();await p.waitForTimeout(600);const id2=await p.evaluate(()=>sj.cur&&sj.cur.id);ok(id1===id2,'sujet retrouvé après rechargement ('+id1+')');
 // plan ligne longue
 const o=await p.evaluate(()=>outline("I. Première partie\ntexte du un deux trois\nII. Deuxième partie\ntexte\nIII. Une troisième partie très longue qui continue. "+"mot ".repeat(60)));ok(o.items.length===3&&o.items[2].w>=55,'plan : titre long reconnu ('+o.items.length+' parties, '+(o.items[2]||{}).w+' mots)');
 ok(!errs.length,'capeps-3 sans erreur '+errs.join('|'));await ctx.close();}
{const {ctx,p,errs}=await mk('capeps-int',true);
 await p.evaluate(()=>{me.tab='e2';setView('methode')});const t=await p.textContent('#panel-methode');ok(/étude de cas/.test(t)&&/bilan prospectif/.test(t)&&/association sportive/.test(t),'capeps-int méthode étude de cas');
 ok(!errs.length,'capeps-int sans erreur '+errs.join('|'));await ctx.close();}
console.log(fails.length?'FAILS: '+fails.join(' | '):'ALL OK');await b.close();})();

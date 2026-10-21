// Version découverte : retour offert, liste d'attente, choix de l'écrit, focus après retournement (API simulée).
const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const fails=[];const ok=(c,m)=>{console.log(c?'ok  ':'FAIL',m);if(!c)fails.push(m)};
const mk=async(logged)=>{const ctx=await b.newContext({viewport:{width:1280,height:900}});
 await ctx.addInitScript(()=>{if(!sessionStorage.getItem('x')){sessionStorage.setItem('x','1');localStorage.setItem('bristol-eps-v1',JSON.stringify({prefs:{concours:'capeps-l3'}}));localStorage.setItem('bristol-eps-welcome','1');}});
 const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));const seen=[];
 await p.route('**/api/**',async r=>{const u=r.request().url();seen.push(r.request().method()+' '+u.replace(/^.*\/api/,'/api')+' '+JSON.stringify(r.request().headers()['x-trial']||''));
  if(/auth\/me/.test(u))return r.fulfill(logged?{status:200,contentType:'application/json',body:JSON.stringify({email:'t@ex.fr',premium:{active:false}})}:{status:401,contentType:'application/json',body:'{"error":"not_signed_in"}'});
  if(/auth\/config/.test(u))return r.fulfill({status:200,contentType:'application/json',body:'{"google":false}'});
  if(/billing\/config/.test(u))return r.fulfill({status:200,contentType:'application/json',body:'{"enabled":false}'});
  if(/waitlist/.test(u))return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
  if(/feedback/.test(u))return r.fulfill({status:200,headers:{'content-type':'text/plain; charset=utf-8','x-trial':'1'},body:'## Ce qui fonctionne\n- Une problématique claire.\n## À ajouter ou corriger\n- Daté.'});
  return r.fulfill({status:404,contentType:'application/json',body:'{"error":"none"}'});});
 await p.goto('http://localhost:8766/app/');await p.waitForTimeout(800);return {ctx,p,errs,seen};};
// 1. non connecté : bouton offert -> compte
{const {ctx,p,errs}=await mk(false);
 await p.evaluate(()=>{sj.epr='e1';sj.mode='plan';setView('sujets')});await p.locator('main button:visible',{hasText:'Tirer un sujet'}).click().catch(()=>{});await p.waitForTimeout(300);
 const btn=p.locator('[data-act=fb-trial]');ok(await btn.count()===1,'bouton « retour offert » visible sans compte');
 await btn.click();await p.waitForTimeout(400);ok(await p.evaluate(()=>acct.open&&sessionStorage.getItem('bristol-eps-intent')==='trial:plan'),'clic sans compte : création de compte, intention gardée');
 ok(/retour offert arrive juste après/.test(await p.textContent('#account')) && !/avant le paiement/.test(await p.textContent('#account')),'fenêtre de compte : retour offert, pas de paiement');
 ok(!errs.length,'sans erreur '+errs.join('|'));await ctx.close();}
// 2. connecté : retour offert puis verrou
{const {ctx,p,errs,seen}=await mk(true);
 await p.evaluate(()=>{sj.epr='e1';sj.mode='plan';setView('sujets')});await p.locator('main button:visible',{hasText:'Tirer un sujet'}).click().catch(()=>{});await p.waitForTimeout(300);
 await p.fill('#sj-notes','Problématique : en quoi la santé a-t-elle changé de sens ? I. Hygiène II. Sport III. Éducation à la santé, avec des repères datés.');await p.waitForTimeout(700);
 await p.locator('[data-act=fb-trial]').click();await p.waitForTimeout(1200);
 const t=await p.textContent('#panel-sujets');ok(/Une problématique claire/.test(t),'retour offert affiché');
 ok(seen.some(s=>/feedback.*"1"/.test(s)),'en-tête x-trial envoyé');
 ok(await p.locator('[data-act=fb-trial]').count()===0 && /Ce retour t'aide/.test(t) && await p.locator('#panel-sujets [data-act=paywall][data-why=claude]').count()===1,'ensuite : le retour, puis l\'accès complet proposé');
 // paywall + liste d'attente
 await p.evaluate(()=>paywall('claude'));await p.waitForTimeout(300);await p.fill('#pw-wait-in','t@ex.fr');await p.click('[data-pwwait] button[type=submit]');await p.waitForTimeout(500);
 ok(/C'est noté/.test(await p.textContent('#paywall')),'liste d\'attente : confirmation');
 await p.keyboard.press('Escape');
 ok(!errs.length,'sans erreur '+errs.join('|'));await ctx.close();}
// 3. découverte sur l'écrit 2, focus après retournement
{const {ctx,p,errs}=await mk(false);
 await p.evaluate(()=>{setView('revise')});await p.waitForTimeout(200);await p.click('[data-grp=e2]');await p.waitForTimeout(300);
 const fg=p.locator('[data-act=free-grp]');ok(await fg.count()===1,'écrit 2 verrouillé : choix « Découvrir l\'écrit 2 à la place »');
 await fg.click();await p.waitForTimeout(400);ok(await p.evaluate(()=>freeGrp()==='e2'&&!grpLocked('e2')&&grpLocked('e1')&&grpGoal('e2').left===5),'écrit 2 ouvert, 5 nouvelles');
 await p.keyboard.press('Space');await p.waitForTimeout(300);
 ok(await p.evaluate(()=>document.activeElement.classList.contains('a')),'focus sur la réponse après retournement');
 await p.keyboard.press('3');await p.waitForTimeout(300);
 ok(await p.evaluate(()=>grpGoal('e1').target)===0,'pas de doublement : écrit 1 verrouillé');
 ok(!errs.length,'sans erreur '+errs.join('|'));await ctx.close();}
// 4. Arrivée depuis une page concours venue d'une annonce : essai en premier, provenance gardée jusqu'au paiement
{const ctx=await b.newContext({viewport:{width:390,height:844}});const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));const ev=[];let co=null,logged=false;
 await p.route('**/api/**',async r=>{const u=r.request().url();
  if(/\/api\/event/.test(u)){ev.push(JSON.parse(r.request().postData()));return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});}
  if(/auth\/me/.test(u))return r.fulfill(logged?{status:200,contentType:'application/json',body:'{"email":"t@ex.fr","premium":{"active":false}}'}:{status:401,contentType:'application/json',body:'{"error":"not_signed_in"}'});
  if(/auth\/config/.test(u))return r.fulfill({status:200,contentType:'application/json',body:'{"google":true}'});
  if(/billing\/config/.test(u))return r.fulfill({status:200,contentType:'application/json',body:'{"enabled":true,"pass":{"label":"80 €","until":"2027-07-31"},"mensuel":{"label":"15 €"},"credits":60}'});
  if(/billing\/checkout/.test(u)){co=JSON.parse(r.request().postData());return r.fulfill({status:200,contentType:'application/json',body:'{"url":"http://localhost:8766/app/#paye"}'});}
  return r.fulfill({status:404,contentType:'application/json',body:'{"error":"none"}'});});
 await p.goto('http://localhost:8766/capeps-interne/?utm_source=google-ads');
 ok(/Essayer/.test(await p.textContent('.go .btn')),'page concours : bouton d\'essai');
 ok(await p.locator('img[src="/img/jury-capeps-int.webp"]').count()===1 && await p.locator('.ex .exf h3').count()>3,'page concours : capture du concours et exemple de retour');
 await p.click('.go .btn');await p.waitForTimeout(1200);
 ok(/Avec ou sans préparation/.test(await p.textContent('#welcome')) && await p.locator('#welcome [data-act=essai-go]').count()===1,'accueil : avec ou sans formation, essai proposé');
 ok(ev.some(x=>x.e==='open'&&x.s==='google-ads') && ev.some(x=>x.e==='concours'&&x.c==='capeps-int'),'provenance et concours envoyés avec les étapes');
 await p.click('#welcome [data-act=essai-go]');await p.waitForTimeout(500);
 ok(await p.evaluate(()=>sj.src==='own'&&sj.mode==='plan'&&!!sj.cur&&!sj.cur.annale),'essai : sujet d\'entraînement (dossier fourni), plan');
 ok(await p.locator('.fb-ex summary').count()===1,'essai : exemple de retour visible avant le compte');
 await p.evaluate(()=>setView('home'));await p.waitForTimeout(200);
 ok(await p.locator('#panel-home .trial-card [data-act=essai-go]').count()===1,'accueil : carte du retour offert');
 logged=true;await p.evaluate(()=>initAccount());await p.waitForTimeout(600);await p.evaluate(()=>paywall('claude'));await p.waitForTimeout(300);
 ok(/par semaine jusqu'à tes écrits/.test(await p.textContent('#paywall')),'offre : prix du pass par semaine');
 await p.click('[data-pwplan=pass]');await p.waitForTimeout(500);
 ok(co&&co.plan==='pass'&&co.src==='google-ads','paiement : provenance transmise');
 ok(!errs.length,'sans erreur '+errs.join('|'));await ctx.close();}
console.log(fails.length?'FAILS: '+fails.join(' | '):'ALL OK');await b.close();})();

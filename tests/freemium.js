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
 ok(!errs.length,'sans erreur '+errs.join('|'));await ctx.close();}
// 2. connecté : retour offert puis verrou
{const {ctx,p,errs,seen}=await mk(true);
 await p.evaluate(()=>{sj.epr='e1';sj.mode='plan';setView('sujets')});await p.locator('main button:visible',{hasText:'Tirer un sujet'}).click().catch(()=>{});await p.waitForTimeout(300);
 await p.fill('#sj-notes','Problématique : en quoi la santé a-t-elle changé de sens ? I. Hygiène II. Sport III. Éducation à la santé, avec des repères datés.');await p.waitForTimeout(700);
 await p.locator('[data-act=fb-trial]').click();await p.waitForTimeout(1200);
 const t=await p.textContent('#panel-sujets');ok(/Une problématique claire/.test(t),'retour offert affiché');
 ok(seen.some(s=>/feedback.*"1"/.test(s)),'en-tête x-trial envoyé');
 ok(await p.locator('[data-act=fb-trial]').count()===0 && /Réservé à l'accès complet/.test(t),'ensuite : verrou');
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
console.log(fails.length?'FAILS: '+fails.join(' | '):'ALL OK');await b.close();})();

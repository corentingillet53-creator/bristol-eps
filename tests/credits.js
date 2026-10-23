// Crédits de retours (abonné) : solde sous le bouton, mise à jour après un retour, refus faute de crédits,
// panneau de recharge et paiement (API simulée). Prérequis : node server.js. Usage : node credits.js → « ALL OK ».
const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const fails=[];const ok=(c,m)=>{console.log(c?'ok  ':'FAIL',m);if(!c)fails.push(m)};
 const ctx=await b.newContext({viewport:{width:1280,height:900}});
 await ctx.addInitScript(()=>{if(!sessionStorage.getItem('x')){sessionStorage.setItem('x','1');localStorage.setItem('bristol-eps-v1',JSON.stringify({prefs:{concours:'agreg-int'}}));localStorage.setItem('bristol-eps-welcome','1');}});
 const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));let fbN=0,checkout=null;
 const J=(body,status=200)=>({status,contentType:'application/json',body:JSON.stringify(body)});
 await p.route('**/api/**',async r=>{const u=r.request().url();
  if(/auth\/me/.test(u))return r.fulfill(J({email:'t@ex.fr',premium:{active:true,plan:'mensuel',until:Date.now()+864e6}}));
  if(/auth\/config/.test(u))return r.fulfill(J({google:false}));
  if(/billing\/config/.test(u))return r.fulfill(J({enabled:true,pass:{label:'80 €',until:'2027-07-31'},mensuel:{label:'15 €'},credits:60,recharge:{enabled:true,label:'5 €',credits:50}}));
  if(/billing\/credits/.test(u))return r.fulfill(J({active:true,allowance:60,used:58,month:2,topup:0,left:2,renews:'2026-11-01'}));
  if(/billing\/checkout/.test(u)){checkout=JSON.parse(r.request().postData());return r.fulfill(J({url:'http://localhost:8766/app/#paye'}));}
  if(/feedback/.test(u)){fbN++;if(fbN===1)return r.fulfill({status:200,headers:{'content-type':'text/plain; charset=utf-8','x-credits':'1/0/1'},body:'## Ce qui fonctionne\n- Une problématique claire.'});
   return r.fulfill(J({error:'no_credits',credits:{allowance:60,used:60,month:0,topup:0,left:0,renews:'2026-11-01'}},402));}
  return r.fulfill(J({error:'none'},404));});
 await p.goto('http://localhost:8766/app/');await p.waitForTimeout(1200);
 await p.evaluate(()=>{sj.epr='e1';sj.mode='plan';setView('sujets')});await p.locator('main button:visible',{hasText:'Tirer un sujet'}).first().click().catch(()=>{});await p.waitForTimeout(400);
 const line=()=>p.locator('.fb-cred').first().textContent().catch(()=>'');
 ok(/1 crédit · il t'en reste 2 ; 60 nouveaux le 1er novembre/.test(await line()),'solde sous le bouton : '+await line());
 await p.fill('#sj-notes','Problématique : en quoi la citation éclaire-t-elle la place de l\'élève ? I. Constat II. Enjeux III. Propositions datées et argumentées.');await p.waitForTimeout(700);
 await p.locator('[data-act=fb-ask]').click();await p.waitForTimeout(1200);
 ok(/il t'en reste 1 /.test(await line()),'après un retour : solde mis à jour par l\'en-tête');
 ok(/Il te reste 1 crédit/.test(await p.textContent('#sj-fb')),'note : il reste peu de crédits');
 await p.waitForTimeout(200);await p.locator('[data-act=fb-ask]').click();await p.waitForTimeout(1000);
 ok(await p.evaluate(()=>pw.open&&pw.why==='recharge'),'refus faute de crédits : panneau de recharge ouvert');
 const pt=await p.textContent('#paywall');ok(/Recharge de 50 crédits/.test(pt)&&/5 €/.test(pt)&&/Il te reste 0 crédit/.test(pt),'panneau : 50 crédits pour 5 €, solde 0');
 await p.click('[data-pwplan=recharge]');await p.waitForTimeout(300);
 await p.waitForTimeout(500);
 ok(checkout&&checkout.plan==='recharge'&&!('renonce' in checkout),'sans case : paiement de la recharge demandé');
 ok(!(await p.$('#pw-renonce'))&&/Satisfait ou remboursé pendant 14 jours/.test(await p.textContent('#paywall')),'panneau : pas de case, satisfait ou remboursé affiché');
 // Prix de lancement : rappelé dans le panneau du pass (compte gratuit), code promo envoyé avec le pass, refusé comme code d'accès.
 {const c2=await b.newContext({viewport:{width:390,height:844}});const q=await c2.newPage();let co=null;q.on('pageerror',e=>errs.push(e.message));
  await q.route('**/api/**',async r=>{const u=r.request().url();
   if(/auth\/me/.test(u))return r.fulfill(J({email:'g@ex.fr',premium:{active:false}}));
   if(/billing\/config/.test(u))return r.fulfill(J({enabled:true,pass:{label:'80 €',until:'2027-07-31'},mensuel:{label:'15 €'},credits:60,recharge:{enabled:true,label:'5 €',credits:50}}));
   if(/billing\/checkout/.test(u)){co=JSON.parse(r.request().postData());return r.fulfill(J({url:'http://localhost:8766/app/#paye'}));}
   return r.fulfill(J({error:'none'},404));});
  await q.goto('http://localhost:8766/app/?concours=capeps-int');await q.waitForTimeout(1000);
  const has=await q.evaluate(()=>!!(typeof OFFRE!=='undefined'&&OFFRE&&offreOn()));
  if(has){await q.evaluate(()=>{hideWelcome();acct.status='in';paywall('menu')});await q.waitForTimeout(500);
   const t=await q.textContent('#paywall');ok(/64\s€/.test(t)&&/LANCEMENT20/.test(t)&&/ensuite 80\s€/.test(t),'panneau : prix de lancement et code rappelés');
   await q.evaluate(()=>{pw.code=true;renderPaywall()});await q.fill('#pw-code-in','lancement20');await q.press('#pw-code-in','Enter');await q.waitForTimeout(300);
   ok(/code promo/.test(await q.textContent('#paywall')),'code promo tapé comme code d\'accès : explication');
   await q.click('[data-pwplan=pass]');await q.waitForTimeout(500);
   ok(co&&co.plan==='pass'&&co.promo==='LANCEMENT20','paiement du pass : code promo envoyé');}
  else ok(true,'offre terminée : rien à vérifier');
  // « Prendre le pass » (accueil) : l'offre s'ouvre dès le concours choisi ; titre sans « sans limite ».
  {const c3=await b.newContext({viewport:{width:390,height:844}});const r=await c3.newPage();r.on('pageerror',e=>errs.push(e.message));await r.goto('http://localhost:8766/');await r.waitForTimeout(300);
   const lt=await r.textContent('#tarifs');ok(!has||(/64\s€\s*80\s€/.test(lt)&&/au lieu de 80/.test(lt)),'tarifs : 64 € en gros, 80 € barré');
   await r.click('#tarifs a:has-text("Prendre le pass")');await r.waitForTimeout(1000);
   await r.evaluate(()=>{localStorage.removeItem('bristol-eps-v1')}).catch(()=>{});
   const onb=r.locator('button:has-text("CAPEPS interne")');if(await onb.count()){await onb.first().click();await r.waitForTimeout(600);}
   const t=await r.evaluate(()=>pw.open?document.querySelector('#paywall').textContent:'FERME');ok(/Prépare (tous tes écrits|ton écrit) jusqu'au concours/.test(t)&&!/sans\s+limite/.test(t),'« Prendre le pass » : offre ouverte après le choix du concours');
   ok(!/achat=/.test(r.url()),'paramètre achat retiré de l\'adresse');await c3.close();}
  await c2.close();}
 ok(!errs.length,'sans erreur '+errs.join('|'));
 await b.close();console.log(fails.length?'FAILS '+fails.length:'ALL OK');process.exit(fails.length?1:0);})();

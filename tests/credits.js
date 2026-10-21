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
 ok(!errs.length,'sans erreur '+errs.join('|'));
 await b.close();console.log(fails.length?'FAILS '+fails.length:'ALL OK');process.exit(fails.length?1:0);})();

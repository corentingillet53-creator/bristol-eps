const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const ctx=await b.newContext({viewport:{width:1200,height:900},locale:'fr-FR'});const p=await ctx.newPage();
const viol=[],errs=[];p.on('console',m=>{if(/Content Security Policy|Refused/i.test(m.text()))viol.push(m.text().slice(0,220));});p.on('pageerror',e=>errs.push(e.message));
await p.addInitScript(()=>document.addEventListener('securitypolicyviolation',e=>console.log('Refused CSP '+e.violatedDirective+' '+e.blockedURI)));
let r=await p.goto('http://localhost:8766/?accueil');console.log('landing CSP header:',!!r.headers()['content-security-policy'],'HSTS',!!r.headers()['strict-transport-security']);
await p.waitForTimeout(600);console.log('landing demo cards:',await p.locator('.demo, [class*=demo]').count());
r=await p.goto('http://localhost:8766/app/');await p.waitForTimeout(800);
console.log('gate:',await p.evaluate(()=>document.documentElement.classList.contains('gate')));
await p.click('[data-onb=capeps-m2]');await p.waitForTimeout(300);
await p.evaluate(()=>{try{hideWelcome()}catch(e){}});await p.waitForTimeout(200);
for(const s of ['revise','train','suivi','home']){await p.evaluate(s=>{const b=document.querySelector(`[data-sec=${s}]`)||document.querySelector(`[data-nav=${s}]`);b&&b.click();},s);await p.waitForTimeout(250);}
const sw=await p.evaluate(async()=>{try{const r=await Promise.race([navigator.serviceWorker.ready,new Promise(r=>setTimeout(()=>r(null),3000))]);return !!(r&&r.active)}catch(e){return 'err '+e}});console.log('sw active',sw);
// lecture audio (data: wav) + téléchargement blob
await p.evaluate(()=>{const a=new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');a.load();const u=URL.createObjectURL(new Blob(['x']));const i=new Image();i.src=u;});
await p.waitForTimeout(400);
// contrôle : un script injecté doit être bloqué
await p.evaluate(()=>{const s=document.createElement('script');s.textContent='window.__pwned=1';document.body.appendChild(s);});await p.waitForTimeout(100);
console.log('injected inline script blocked:',!(await p.evaluate(()=>window.__pwned)));
console.log('violations:',viol.filter(v=>!/__pwned|inline/.test(v)||true));console.log('errors',errs);await b.close();})();

const { chromium } = require('playwright');const fs=require('fs');
const AXE=fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8');
const steps=[
 ['welcome',async p=>{}],
 ['home-choose',async p=>{await p.evaluate(()=>{welcomeOpen=false;window.__pp=prefs;prefs=Object.assign({},prefs,{concours:'',examDate:''});render();});}],
 ['home',async p=>{await p.evaluate(()=>{prefs=window.__pp;welcomeOpen=false;render();});}],
 ['revise',async p=>{await p.click('#sec-revise');await p.click('#tab-revise');}],
 ['revise-flip',async p=>{await p.click('[data-act=flip]');}],
 ['fils',async p=>{await p.click('#tab-fils');}],
 ['refs',async p=>{await p.click('#tab-refs');}],
 ['concours',async p=>{await p.click('#sec-suivi');await p.click('#tab-concours');}],
 ['concours-detail',async p=>{const b=await p.$('#panel-concours [data-conc], #panel-concours button.conc-card, #panel-concours [data-act=conc-open]');if(b)await b.click();}],
 ['deck',async p=>{await p.click('#sec-revise');await p.click('#tab-deck');}],
 ['frise',async p=>{await p.click('#tab-frise');}],
 ['qui',async p=>{await p.click('#tab-qui');}],
 ['sujets',async p=>{await p.click('#sec-train');await p.click('#tab-sujets');}],
 ['annales',async p=>{await p.click('#tab-annales');}],
 ['methode',async p=>{await p.click('#tab-methode');}],
 ['stats',async p=>{await p.click('#sec-suivi');await p.click('#tab-stats');}],
 ['blanc',async p=>{await p.click('#sec-train');await p.click('#tab-blanc');}],
 ['blanc-run',async p=>{await p.click('[data-act=blanc-start]');await p.click('[data-act=blanc-start][data-ok]');await p.fill('#blanc-copy','Texte '.repeat(80));}],
 ['blanc-focus',async p=>{await p.fill('#blanc-copy','Introduction\nTexte\nI. Partie\nA. Sous-partie\n'+'mot '.repeat(50));await p.waitForTimeout(500);await p.click('.blanc-focus');}],
 ['blanc-home',async p=>{await p.keyboard.press('Escape');await p.click('#sec-home');}],
 ['blanc-done',async p=>{await p.click('[data-act=blanc-go]');await p.click('[data-act=blanc-submit]');await p.click('[data-act=blanc-submit][data-ok]');}],
 ['home-write',async p=>{await p.click('#sec-home');await p.click('[data-act=home-write]');}],
 ['annale-open',async p=>{await p.click('#sec-train');await p.click('#tab-annales');const b=await p.$('#panel-annales .ann-card button, #panel-annales [data-ann], #panel-annales button.btn');if(b)await b.click();}],
 ['add',async p=>{await p.click('#sec-revise');await p.click('#tab-deck');const b=await p.$('[data-act=add], [data-tab=add], [data-view=add]');if(b)await b.click();else await p.evaluate(()=>setView('add'));}],
 ['test',async p=>{await p.evaluate(()=>ptStart());}],
 ['test-ans',async p=>{await p.click('[data-pt="?"]');}],
 ['test-res',async p=>{await p.evaluate(()=>{for(const q of pt.qs){if(q.r===null){q.r='ok';q.k='0';}}ptFinish();});}],
 ['sources',async p=>{await p.click('#sec-suivi');await p.click('#tab-sources');}],
 ['stats-cov',async p=>{await p.click('#tab-stats');}],
 ['b3-sujets',async p=>{await p.evaluate(()=>{chooseConcours('capeps-l3');setView('sujets');});await p.click('[data-act=sj-draw]');}],
 ['b3-e2',async p=>{await p.click('[data-sjepr=e2]');await p.click('[data-act=sj-draw]');await p.click('[data-sjmode=para]');await p.click('[data-act=sj-show]');}],
 ['b3-meth',async p=>{await p.click('#tab-methode');}],
 ['b3-jury',async p=>{await p.click('[data-metab=jury]');}],
 ['b3-blanc',async p=>{await p.click('#tab-blanc');}],
 ['agint-sujets',async p=>{await p.evaluate(()=>{chooseConcours('agreg-int');setView('sujets');});await p.click('[data-act=sj-draw]');await p.click('[data-act=sj-show]');}],
 ['cint-sujets',async p=>{await p.evaluate(()=>{chooseConcours('capeps-int');setView('sujets');});}],
 ['account',async p=>{await p.evaluate(()=>{const b=document.querySelector('#account-open');if(b){b.hidden=false;b.click();}});}],
];
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const all={};
for(const [mode,w] of [['light',1440],['dark',1440],['light',390],['dark',390]]){
 const ctx=await b.newContext({viewport:{width:w,height:900},colorScheme:mode,locale:'fr-FR',bypassCSP:true});await ctx.addInitScript(()=>{try{localStorage.setItem('bristol-eps-plan',JSON.stringify({active:true,plan:'code'}));}catch(e){}});const p=await ctx.newPage();
 await p.goto('http://localhost:8766/app/');await p.waitForTimeout(600);
 await p.evaluate(()=>{prefs=Object.assign({},prefs,{concours:"agreg-int",examDate:"2027-01-25"});const now=Date.now();allCards().slice(0,40).forEach((c,i)=>{progress[c.id]={b:1+i%5,d:now+((i*7)%11-1)*864e5,t:now,n:1,l:i%3}});persist();render();});
 for(const [n,fn] of steps){try{await fn(p);}catch(e){console.log('step fail',n,e.message.split('\n')[0]);}
  await p.waitForTimeout(150);await p.addScriptTag({content:AXE});
  const r=await p.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice']},resultTypes:['violations']});return r.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.slice(0,400).map(n=>n.target.join(' ')+' :: '+(n.failureSummary||'').split('\n').slice(1,2).join('')).concat(v.nodes.length>400?['+'+(v.nodes.length-4)+' more']:[])}));});
  for(const v of r){const k=v.id;all[k]=all[k]||{impact:v.impact,help:v.help,where:{}};all[k].where[`${mode}-${w}-${n}`]=v.nodes;}
 }
 await ctx.close();}
fs.writeFileSync('axe-report.json',JSON.stringify(all,null,1));
for(const [k,v] of Object.entries(all)){console.log(`\n## ${k} (${v.impact}) ${v.help} — ${Object.keys(v.where).length} views`);const first=Object.entries(v.where).slice(0,3);for(const [w,n] of first)console.log('  ',w,'\n     '+n.join('\n     ').slice(0,700));}
await b.close();})();

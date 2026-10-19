const {JSDOM}=require('jsdom');const fs=require('fs');
const html='<!doctype html><html><head></head><body>'+fs.readFileSync(require('path').join(__dirname,'..','source','bristol-eps.html'),'utf8')+'</body></html>';
const conc=process.argv[2]||'agreg-int';
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.test/',beforeParse(w){w.localStorage.setItem('bristol-eps-welcome','1');w.localStorage.setItem('bristol-eps-test','{"t":1,"ok":5,"n":12,"by":{}}');w.scrollTo=()=>{};
 w.localStorage.setItem('bristol-eps-v1',JSON.stringify({prefs:{concours:conc,t:1}}));w.fetch=async()=>({status:401,json:async()=>({})});}});
const w=dom.window,d=w.document;const errs=[];w.addEventListener('error',e=>errs.push(e.message));
setTimeout(()=>{
 const e=w.eval('relHas("e1")')?'e1':'e2';
 w.eval(`(()=>{const P=sjPools("${e}"),L=P.ann.map(annSubject).concat(P.own);const ks=skAsk("${e}","plan");
  L.slice(0,3).forEach((x,i)=>txSet("f:"+x.id,"## r\\nBILAN: "+ks.map((k,j)=>k+"="+((i+j)%3)).join("; ")));
  const x=L[0]; const g=skAsk("${e}","para"); txSet("p:"+x.id,"y".repeat(200)); txSet("c:p-"+x.id,"[0,2]");
  const m={id:"bt1",k:"${conc==='capeps-int'?'ei':e}",s:"Écrit",co:"",f:"",src:"own",sid:x.id,dur:14400,start:Date.now()-5e6,end:Date.now()-1e6,state:"done",paper:0};
  txSet("bm:bt1",JSON.stringify(m)); txSet("b:bt1",("mot ".repeat(400))+"\\nConclusion\\nfin"); txSet("f:b:bt1","## c\\nBILAN: "+skAsk("${e}","copie").map(k=>k+"=1").join("; "));
 })()`);
 const st=JSON.parse(w.eval('JSON.stringify(skStats())'));
 console.log(conc,e,w.eval('skFmt("'+e+'")'),st.filter(x=>x.n).map(x=>x.k+'='+x.sc+'('+x.n+')').join(' '));
 console.log(' weak:',w.eval('(skWeak()||{}).l'),'| train:',w.eval('skWeak()&&skTrain(skWeak()).l'),'| ready',w.eval('JSON.stringify(readyAll())'));
 w.eval('render()'); w.eval('setView("progres")');
 console.log(' errors',errs);process.exit(0);},150);

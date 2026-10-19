// Sert public/ en appliquant les règles de public/_headers (comme Cloudflare).
const http=require('http'),fs=require('fs'),path=require('path');const root=require('path').join(__dirname,'..','public');
const rules=[];let cur=null;for(const l of fs.readFileSync(root+'/_headers','utf8').split('\n')){if(!l.trim()||l.startsWith('#'))continue;if(!/^\s/.test(l)){cur={p:l.trim(),h:{}};rules.push(cur);}else{const i=l.indexOf(':');cur.h[l.slice(0,i).trim()]=l.slice(i+1).trim();}}
const match=(p,u)=>p.endsWith('*')?u.startsWith(p.slice(0,-1)):p===u;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webmanifest':'application/manifest+json','.json':'application/json','.svg':'image/svg+xml','.css':'text/css','.woff2':'font/woff2','.webp':'image/webp','.txt':'text/plain'};
http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);let f=path.join(root,u);if(fs.existsSync(f)&&fs.statSync(f).isDirectory())f=path.join(f,'index.html');
 if(!fs.existsSync(f)){if(u.startsWith('/api/')){r.writeHead(404,{'content-type':'application/json'});return r.end('{"error":"none"}');}r.writeHead(404);return r.end('nf');}
 const h={'content-type':types[path.extname(f)]||'application/octet-stream'};for(const ru of rules)if(match(ru.p,u))for(const[k,v]of Object.entries(ru.h))h[k]=h[k]?h[k]+', '+v:v;
 r.writeHead(200,h);fs.createReadStream(f).pipe(r);}).listen(8766,()=>console.log('csp server 8766'));

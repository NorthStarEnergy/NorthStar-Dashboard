// The apex Site serves the shared UI and forwards only visitor API requests.
const base='/outage-manager', cookieName='northstar_outage_visitor';
const origin='https://ops.northstarenergy.ca';
const htmlFiles=new Set(['outage-manager.html','outage-manager-package.html']);
const security={
  'cache-control':'private, no-store','referrer-policy':'same-origin','x-content-type-options':'nosniff',
  'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
};
function page(body,status=200){
  return new Response(body,{status,headers:{...security,'content-type':'text/html; charset=utf-8'}});
}
function entry(message=''){
  return page(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Outage Manager</title><style>*{box-sizing:border-box}body{margin:0;background:#eff4f4;color:#173946;font:15px system-ui;min-height:100svh;display:grid;place-items:center;padding:18px}
    form{width:min(100%,340px);background:white;border:1px solid #cad6d8;border-radius:8px;padding:22px}h1{font-size:21px;margin:0 0 18px}
    label{display:grid;gap:5px;font-weight:600}input,button{font:inherit;border-radius:4px;padding:9px}input{border:1px solid #9aacb1}button{margin-top:12px;width:100%;color:white;background:#205d57;border:0}p{color:#922d31}</style>
    <form method="post" action="${base}/entry"><h1>Outage Manager</h1><label>Passcode<input type="password" name="passcode" required maxlength="64" autofocus autocomplete="current-password"></label>
    ${message?`<p role="alert">${message}</p>`:''}<button>Enter</button></form></html>`);
}
function go(value,seconds){
  return new Response(null,{status:303,headers:{...security,location:base+'/',
    'set-cookie':`${cookieName}=${value}; Path=${base}; Max-Age=${seconds}; Secure; HttpOnly; SameSite=Lax`}});
}
export async function publicOutage(request,assets,upstreamFetch=fetch){
  const url=new URL(request.url);
  if(url.pathname!==base && !url.pathname.startsWith(base+'/'))return null;
  const path=url.pathname.slice(base.length).replace(/^\//,'');
  const match=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='));
  const token=match?.slice(cookieName.length+1)||'';
  const valid=/^[a-f0-9]{64}$/.test(token);
  if(!['GET','HEAD','POST'].includes(request.method))return new Response(null,{status:405,headers:security});
  if(request.method==='POST' && request.headers.get('origin')!==url.origin)return new Response(null,{status:403,headers:security});
  async function upstream(route,method='GET',body,extra={}){
    const headers=new Headers(extra);if(valid)headers.set('authorization','Bearer '+token);
    return upstreamFetch(origin+'/public-outage-api/'+route,{method,body,headers,redirect:'manual',cache:'no-store'});
  }
  if(path==='entry' && request.method==='POST'){
    if(Number(request.headers.get('content-length'))>512)return entry('Enter a valid passcode.');
    const passcode=new URLSearchParams(await request.text()).get('passcode')||'';
    const r=await upstream('entry','POST',JSON.stringify({passcode}),{'content-type':'application/json'});
    if(r.status!==201)return entry(r.status===401?'Incorrect passcode.':r.status===429?'Try again in a minute.':'Outage Manager is temporarily unavailable.');
    const session=await r.json();
    if(!/^[a-f0-9]{64}$/.test(session.token))return entry('Please try again.');
    return go(session.token,session.maxAge);
  }
  if(path==='exit' && request.method==='POST'){
    if(valid)await upstream('logout','POST','{}',{'content-type':'application/json'});
    return go('',0);
  }
  if(path==='api/sites' || path==='api/uwpc/requests' || path.startsWith('api/uwpc/requests/')){
    if(!valid)return Response.json({error:'Enter the Outage Manager passcode.'},{status:401,headers:security});
    const endpoint=path==='api/sites'?'sites':path.slice('api/uwpc/requests'.length).replace(/^\//,'');
    const headers={};
    for(const key of ['content-type','x-northstar-checkout','x-northstar-filename']){
      if(request.headers.has(key))headers[key]=request.headers.get(key);
    }
    const length=Number(request.headers.get('content-length'));
    if(length>10*1024*1024)return new Response(null,{status:413,headers:security});
    const body=request.method==='POST'?await request.arrayBuffer():undefined;
    if(body?.byteLength>10*1024*1024)return new Response(null,{status:413,headers:security});
    const r=await upstream(endpoint+url.search,request.method,body,headers);
    const responseHeaders=new Headers({...security,'content-security-policy':"sandbox; default-src 'none'"});
    for(const key of ['content-type','content-disposition','x-content-sha256']){
      if(r.headers.has(key))responseHeaders.set(key,r.headers.get(key));
    }
    return new Response(r.body,{status:r.status,headers:responseHeaders});
  }
  if(request.method==='POST')return new Response(null,{status:404,headers:security});
  const file=path||'outage-manager.html';
  if(!Object.hasOwn(assets,file))return new Response(null,{status:404,headers:security});
  const html=htmlFiles.has(file);
  const r=valid?await upstream('identity'):null;
  if(!r || r.status===401)return html?entry():new Response(null,{status:401,headers:security});
  if(!r.ok)return page('Outage Manager is temporarily unavailable.',503);
  if(html){
    const {actor}=await r.json();
    if(!/^Tester[0-9]+$/.test(actor))return page('Session unavailable.',503);
    if(url.pathname===base)return new Response(null,{status:302,headers:{...security,location:base+'/'}});
    return page(assets[file].replace('<body','<body data-outage-visitor="'+actor+'"'));
  }
  return new Response(request.method==='HEAD'?null:assets[file],{headers:{...security,
    'content-type':file.endsWith('.js')?'application/javascript; charset=utf-8':'text/css; charset=utf-8'}});
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createGateway} from '../server/gateway.mjs';
import {isolatedLoopback} from './helpers/http.mjs';
test('real loopback login HTTP routes isolate QR images and invalidate account revisions on authorization',async()=>{
  const providers={headers:()=>({}),net:{clearIdentity:()=>{}}};let code='waiting',now=10000;
  const handler=createGateway({providers,now:()=>now,loginProtocols:{start:async r=>{r.key='fixture-private';return {image:Buffer.from('fixture-png')};},poll:async()=>({status:code,cookie:'qqmusic_key=fixture-private-cookie'}),profile:async()=>({name:'fixture-name'})}});
  const server=createServer((req,res)=>handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  try {
    const first=await isolatedLoopback(base+'/api/accounts'),cookie=first.headers.get('set-cookie').split(';')[0],initial=await first.json();
    const send=(path,value,headers={})=>isolatedLoopback(base+path,{method:value?'POST':'GET',headers:{Cookie:cookie,...(value?{'Content-Type':'application/json'}:{}),...headers},body:value?JSON.stringify(value):undefined});
    const input={source:'qq',method:'qq',id:'1'.repeat(48),intent:1,revision:initial.revision};const challenge=await (await send('/api/login/start',input)).json();assert.equal(challenge.status,'waiting');assert.doesNotMatch(JSON.stringify(challenge),/fixture-private/);
    const image=await send(challenge.imagePath);assert.equal(image.status,200);assert.equal(image.headers.get('cache-control'),'no-store');assert.equal(image.headers.get('content-type'),'image/png');await image.arrayBuffer();
    assert.equal((await isolatedLoopback(base+challenge.imagePath)).status,410);
    assert.equal((await send('/api/login/start',{...input,id:'2'.repeat(48),intent:2},{Origin:'https://evil.test'})).status,403);
    code='authorized';const auth=await (await send('/api/login/poll',{id:challenge.id})).json();assert.equal(auth.status,'authorized');assert.doesNotMatch(JSON.stringify(auth),/private-cookie/);
    const state=await (await send('/api/accounts')).json();assert.notEqual(state.revision,initial.revision);assert.equal(state.accounts[0].status,'unverified');assert.equal((await send(challenge.imagePath)).status,410);
    assert.equal((await send('/api/login/start',{...input,intent:3})).status,409);
    const checked=await (await send('/api/account/check',{source:'qq'})).json();assert.equal(checked.accounts[0].name,'fixture-name');assert.equal(checked.accounts[0].status,'verified');
    await send('/api/account',{source:'qq',cookie:''});assert.equal((await (await send('/api/accounts')).json()).accounts[0].connected,false);
    const malformed=await isolatedLoopback(base+'/api/login/start',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'null'});assert.equal(malformed.status,400);
    now+=86400001;const replacement=await send('/api/accounts');assert.ok(replacement.headers.get('set-cookie'));assert.ok((await replacement.json()).accounts.every(a=>a.connected===false));
  } finally {await new Promise(r=>server.close(r));}
});
test('real gateway uses production Bilibili protocol validation for the current account-domain QR and its cancellation',async()=>{
  const calls=[],qr='https://account.bilibili.com/h5/account-h5/auth/scan-web?navhide=1&callback=close&qrcode_key=fixture_key&from=main-web';
  const providers={headers:()=>({}),net:{clearIdentity(){},reply:async(source,address)=>{
    calls.push({source,address});assert.equal(source,'bili');
    if(address==='https://passport.bilibili.com/x/passport-login/web/qrcode/generate')return {body:{code:0,data:{url:qr,qrcode_key:'fixture_key'}},headers:new Headers(),status:200};
    if(address==='https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=fixture_key')return {body:{code:0,data:{code:86101}},headers:new Headers(),status:200};
    throw new Error('Unexpected fixture protocol request');
  }}};
  const handler=createGateway({providers}),server=createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  try{
    const first=await isolatedLoopback(base+'/api/accounts'),cookie=first.headers.get('set-cookie').split(';')[0],account=await first.json();
    const send=(path,body)=>isolatedLoopback(base+path,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const input={source:'bili',method:'qr',id:'2'.repeat(48),intent:1,revision:account.revision};
    const started=await send('/api/login/start',input);assert.equal(started.status,200);assert.equal(started.headers.get('cache-control'),'no-store');const challenge=await started.json();assert.equal(challenge.url,qr);assert.equal(challenge.status,'waiting');
    assert.equal((await (await send('/api/login/poll',{id:input.id})).json()).status,'waiting');
    assert.equal((await send('/api/login/cancel',input)).status,200);assert.equal((await send('/api/login/poll',{id:input.id})).status,410);
    assert.equal(calls.length,2);assert.ok(calls.every(row=>new URL(row.address).hostname==='passport.bilibili.com'));
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('two simultaneous loopback ports do not overwrite browser session ownership',async()=>{
  const servers=[0,1].map(()=>createServer(createGateway({providers:{headers:()=>({}),net:{clearIdentity(){}}}})));
  await Promise.all(servers.map(s=>new Promise(r=>s.listen(0,'127.0.0.1',r))));
  const jar=new Map(),bases=servers.map(s=>'http://127.0.0.1:'+s.address().port);
  const read=async base=>{
    const response=await isolatedLoopback(base+'/api/accounts',{headers:{Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')}});
    const cookie=response.headers.get('set-cookie');if(cookie){const pair=cookie.split(';')[0],index=pair.indexOf('=');jar.set(pair.slice(0,index),pair.slice(index+1));assert.match(cookie,/HttpOnly; SameSite=Strict/)}
    return response.json();
  };
  try{
    const first=await read(bases[0]),second=await read(bases[1]);assert.notEqual(first.revision,second.revision);assert.equal(jar.size,2);
    for(let i=0;i<20;i++){assert.equal((await read(bases[0])).revision,first.revision);assert.equal((await read(bases[1])).revision,second.revision)}
    assert.deepEqual([...jar.keys()].sort(),servers.map(s=>'tinglan_session_'+s.address().port).sort());
    // The old cookie may be present from an older still-running companion; leave it untouched.
    jar.set('tinglan_session','legacy-owner');assert.equal((await read(bases[0])).revision,first.revision);assert.equal(jar.get('tinglan_session'),'legacy-owner');
  }finally{await Promise.all(servers.map(s=>new Promise(r=>s.close(r))))}
});

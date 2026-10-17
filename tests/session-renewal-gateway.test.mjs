import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createGateway} from '../server/gateway.mjs';
import {PlatformProviders} from '../server/providers.mjs';
import {RequestGovernor,PlatformError} from '../server/upstream.mjs';
import {isolatedLoopback} from './helpers/http.mjs';

test('real companion HTTP installs private QR renewal credentials, rotates on schedule and clears them on logout',async()=>{
  let now=1790983071000;const calls=[],timers=new Map();let timerId=0;
  const cookieHeaders=(key,csrf)=>({'set-cookie':`DedeUserID=123; Domain=.bilibili.com, SESSDATA=${key}; Domain=.bilibili.com, bili_jct=${csrf}; Domain=.bilibili.com`});
  const fetcher=async(address,options)=>{
    const url=new URL(address),path=url.pathname;calls.push(path);let body,headers={};
    if(path.endsWith('/qrcode/generate'))body={code:0,data:{qrcode_key:'fixture_key',url:'https://account.bilibili.com/h5/account-h5/auth/scan-web?qrcode_key=fixture_key'}};
    else if(path.endsWith('/qrcode/poll')){body={code:0,data:{code:0,refresh_token:'fixture-old-refresh'}};headers=cookieHeaders('fixture-old-session','a'.repeat(32));}
    else if(path.endsWith('/cookie/info'))body={code:0,data:{refresh:true,timestamp:now}};
    else if(path.startsWith('/correspond/1/'))return new Response('<div id="1-name">fixture-refresh-csrf</div>');
    else if(path.endsWith('/cookie/refresh')){assert.match(options.headers.Cookie,/old-session/);assert.equal(new URLSearchParams(options.body).get('refresh_token'),'fixture-old-refresh');body={code:0,data:{refresh_token:'fixture-new-refresh'}};headers=cookieHeaders('fixture-new-session','b'.repeat(32));}
    else if(path.endsWith('/confirm/refresh')){assert.match(options.headers.Cookie,/new-session/);assert.equal(new URLSearchParams(options.body).get('refresh_token'),'fixture-old-refresh');body={code:0};}
    else if(path==='/x/web-interface/nav'){assert.match(options.headers.Cookie,/new-session/);body={code:0,data:{isLogin:true,uname:'fixture-profile'}};}
    else throw new Error('Unexpected protocol destination');
    return new Response(JSON.stringify(body),{headers:{'content-type':'application/json',...headers}});
  };
  const providers=new PlatformProviders(new RequestGovernor({fetcher,now:()=>now,gap:0})),handler=createGateway({providers,now:()=>now,renewalTimers:{setTimer:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimer:id=>timers.delete(id)}});
  const server=createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  try{
    const first=await isolatedLoopback(base+'/api/accounts'),sessionCookie=first.headers.get('set-cookie').split(';')[0],initial=await first.json();
    const send=async(path,input)=>{const response=await isolatedLoopback(base+path,{method:input?'POST':'GET',headers:{Cookie:sessionCookie,...(input?{'Content-Type':'application/json'}:{})},body:input?JSON.stringify(input):undefined});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');return response.json();};
    const input={source:'bili',method:'qr',id:'4'.repeat(48),intent:1,revision:initial.revision};await send('/api/login/start',input);const auth=await send('/api/login/poll',{id:input.id});assert.equal(auth.status,'authorized');
    const connected=await send('/api/accounts');assert.equal(connected.accounts[1].automaticRenewal,true);assert.equal(timers.size,1);assert.doesNotMatch(JSON.stringify([auth,connected]),/fixture-old-refresh|fixture-old-session|refresh_token|credential/);
    now+=6*3600000;const verified=await send('/api/account/check',{source:'bili'});assert.equal(verified.accounts[1].status,'verified');assert.equal(verified.accounts[1].renewalStatus,'refreshed');assert.equal(verified.revision,connected.revision);assert.equal(verified.accounts[1].name,'fixture-profile');assert.equal(calls.filter(path=>path.endsWith('/cookie/refresh')).length,1);assert.equal(calls.filter(path=>path.endsWith('/confirm/refresh')).length,1);assert.equal(timers.size,1);
    await send('/api/account',{source:'bili',cookie:''});const loggedOut=await send('/api/accounts');assert.equal(loggedOut.accounts[1].connected,false);assert.equal(loggedOut.accounts[1].automaticRenewal,false);assert.equal(timers.size,0);assert.notEqual(loggedOut.revision,connected.revision);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('platform reads retry once with refreshed credentials and updated QQ override headers',async()=>{
  const session={id:'fixture',generation:1,authRevision:0,cookies:{qq:'uin=123; qm_keyst=fixture-old-key; login_type=2'}},requests=[];let forced=0;
  const providers=new PlatformProviders({json:async(_source,_url,options,_ttl,identity)=>{requests.push({body:JSON.parse(options.body),cookie:options.headers.Cookie,identity});if(requests.length===1)throw new PlatformError('sign-in','expired',401);return {code:0,req_0:{code:0,data:{songs:[]}}};}});
  providers.renewal={renew:async(_session,_source,options)=>{if(options?.force){++forced;session.cookies.qq='uin=123; qm_keyst=fixture-new-key; login_type=2';++session.authRevision;}return 'refreshed';}};
  await providers.qq('music.vkey.GetVkey','UrlGetVkey',{},session,{ct:19,authst:'fixture-old-key',uin:'123'});assert.equal(forced,1);assert.equal(requests.length,2);assert.equal(requests[1].body.comm.authst,'fixture-new-key');assert.match(requests[1].cookie,/new-key/);assert.notEqual(requests[0].identity,requests[1].identity);
});
test('rights and verification denials never force renewal or repeat a content request',async()=>{
  for(const code of ['rights','verification','cooldown']){let forced=0,calls=0;const providers=new PlatformProviders({json:async()=>{++calls;throw new PlatformError(code,'denied',code==='rights'?403:429);}});providers.renewal={renew:async(_session,_source,options)=>{if(options?.force)++forced;return 'healthy';}};await assert.rejects(providers.bili('/x/web-interface/nav',{}, {id:'fixture',generation:0,cookies:{bili:'fixture'}}),{code});assert.equal(forced,0);assert.equal(calls,1);}
});
test('a read rejected after a background rotation uses the new session without rotating it again',async()=>{
  let reject,calls=0,forced=0;const pending=new Promise((_,no)=>reject=no),session={id:'fixture',generation:0,cookies:{bili:'old'}};
  const providers=new PlatformProviders({json:async()=>++calls===1?pending:{code:0,data:{ok:true}}});providers.renewal={renew:async(_s,_source,options)=>{if(options?.force)++forced;return 'healthy';}};
  const result=providers.bili('/test',{},session);for(let i=0;i<8;i++)await Promise.resolve();session.cookies.bili='new';++session.authRevision;reject(new PlatformError('sign-in','old token',401));assert.equal((await result).data.ok,true);assert.equal(calls,2);assert.equal(forced,0);
});

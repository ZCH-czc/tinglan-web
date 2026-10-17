import test from 'node:test';import assert from 'node:assert/strict';
import {SessionRenewalProtocols,biliCorrespondPath} from '../server/session-renewal-protocols.mjs';
import {qqCredential,biliWebCredential} from '../server/session-credentials.mjs';
import {cookieHeader,LoginProtocols} from '../server/login-protocols.mjs';
const response=(body,headers={})=>({body,headers:new Headers(headers),status:200});
const oldValues={DedeUserID:'123',SESSDATA:'fixture-old-session',bili_jct:'a'.repeat(32)};
const newValues={DedeUserID:'123',SESSDATA:'fixture-new-session',bili_jct:'b'.repeat(32)};
const setCookie=values=>Object.entries(values).map(([k,v])=>`${k}=${v}; Domain=.bilibili.com`).join(', ');
const biliSnapshot=()=>({source:'bili',cookie:cookieHeader(oldValues),credential:biliWebCredential({refresh_token:'fixture-old-refresh'},oldValues,1000),signal:new AbortController().signal,identity:'fixture-renewal'});
const fixture=handler=>{const calls=[],providers={headers:(_source,cookie)=>({Cookie:cookie,Referer:'https://www.bilibili.com/'}),net:{reply:async(...args)=>{calls.push(args);return handler(args,calls.length);}}};return {protocols:new SessionRenewalProtocols(providers,{now:()=>10000}),providers,calls};};
test('Bilibili rotation uses fixed destinations, correct CSRF/token pairing and confirms with the new session',async()=>{
  const f=fixture(([source,url,options,identity,format],index)=>{
    assert.equal(source,'bili');assert.equal(identity,'fixture-renewal');assert.equal(options.cache,'no-store');assert.equal(options.headers.Origin,'https://www.bilibili.com');
    const address=new URL(url),form=new URLSearchParams(options.body);
    if(index===1){assert.equal(address.origin,'https://passport.bilibili.com');assert.equal(address.pathname,'/x/passport-login/web/cookie/info');assert.equal(address.searchParams.get('csrf'),'a'.repeat(32));return response({code:0,data:{refresh:true,timestamp:1790983071000}});}
    if(index===2){assert.equal(address.origin,'https://www.bilibili.com');assert.match(address.pathname,/^\/correspond\/1\/[a-f0-9]{256}$/);assert.equal(format,'text');return response('<div id="1-name">fixture-refresh-csrf</div>');}
    if(index===3){assert.equal(address.pathname,'/x/passport-login/web/cookie/refresh');assert.equal(form.get('csrf'),'a'.repeat(32));assert.equal(form.get('refresh_csrf'),'fixture-refresh-csrf');assert.equal(form.get('refresh_token'),'fixture-old-refresh');assert.equal(form.get('source'),'main_web');assert.match(options.headers.Cookie,/old-session/);return response({code:0,data:{refresh_token:'fixture-new-refresh'}},{'set-cookie':setCookie(newValues)});}
    assert.equal(index,4);assert.equal(address.pathname,'/x/passport-login/web/confirm/refresh');assert.equal(form.get('csrf'),'b'.repeat(32));assert.equal(form.get('refresh_token'),'fixture-old-refresh');assert.match(options.headers.Cookie,/new-session/);return response({code:0});
  });
  const snapshot=biliSnapshot(),answer=await f.protocols.refresh(snapshot);assert.equal(answer.outcome,'refreshed');assert.equal(answer.credential.refresh_token,'fixture-new-refresh');assert.equal(answer.credential.pendingConfirm,'fixture-old-refresh');assert.equal(f.calls.length,3);
  await f.protocols.confirm({...snapshot,cookie:answer.cookie,credential:answer.credential});assert.equal(f.calls.length,4);
});
test('healthy Bilibili sessions do not rotate, while explicit rejection is distinguished from invalid data',async()=>{
  for(const [body,outcome] of [[{code:0,data:{refresh:false}},'healthy'],[{code:-101},'rejected']]){const f=fixture(()=>response(body));assert.equal((await f.protocols.refresh(biliSnapshot())).outcome,outcome);assert.equal(f.calls.length,1);}
  for(const body of [{code:0,data:{refresh:'true'}},{code:0,data:{refresh:true,timestamp:0}}]){const f=fixture(()=>response(body));await assert.rejects(f.protocols.refresh(biliSnapshot()),{code:'invalid-response'});assert.equal(f.calls.length,1);}
});
test('Bilibili partial, foreign-domain and cross-account cookies never replace the current session',async()=>{
  for(const headers of [{'set-cookie':setCookie({...newValues,DedeUserID:'456'})},{'set-cookie':setCookie({SESSDATA:'partial'})},{'set-cookie':setCookie(newValues).replaceAll('.bilibili.com','evil.test')}]){
    const f=fixture((_,index)=>index===1?response({code:0,data:{refresh:true,timestamp:1790983071000}}):index===2?response('<div id="1-name">fixture-refresh-csrf</div>'):response({code:0,data:{refresh_token:'fixture-new-refresh'}},headers));await assert.rejects(f.protocols.refresh(biliSnapshot()),{code:'invalid-response'});assert.equal(f.calls.length,3);
  }
  assert.notEqual(biliCorrespondPath(1790983071000),biliCorrespondPath(1790983071000));
});
test('QQ renews through the Android music Login module only when near expiry or explicitly forced',async()=>{
  const old=qqCredential({musicid:123,musickey:'fixture-old-key',openid:'fixture-open',refresh_key:'fixture-refresh',access_token:'fixture-access',expired_at:42},2,10000),snapshot={source:'qq',credential:old,cookie:'uin=123; qm_keyst=fixture-old-key',signal:new AbortController().signal,identity:'fixture-renewal'};
  const f=fixture(([source,address,options])=>{assert.equal(source,'qq');assert.equal(address,'https://u.y.qq.com/cgi-bin/musicu.fcg');const body=JSON.parse(options.body);assert.equal(body.req_0.module,'music.login.LoginServer');assert.equal(body.req_0.method,'Login');assert.equal(body.req_0.param.loginMode,2);assert.equal(body.req_0.param.expired_in,42);assert.equal(body.req_0.param.access_token,'fixture-access');assert.equal(body.comm.authst,'fixture-old-key');assert.equal(body.comm.uin,'123');return response({code:0,req_0:{code:0,data:{musicid:123,musickey:'fixture-new-key',refresh_key:'fixture-rotated-refresh'}}});});
  assert.equal((await f.protocols.refresh(snapshot)).outcome,'healthy');assert.equal(f.calls.length,0);const answer=await f.protocols.refresh(snapshot,true);assert.equal(answer.outcome,'refreshed');assert.equal(answer.credential.refresh_key,'fixture-rotated-refresh');assert.match(answer.cookie,/new-key/);assert.equal(f.calls.length,1);
});
test('QQ rejection, malformed keys and a conflicting returned identity do not commit',async()=>{
  const old=qqCredential({musicid:123,musickey:'fixture-old-key',openid:'fixture-open',refresh_token:'fixture-refresh'}),snapshot={source:'qq',credential:old,cookie:'uin=123',signal:new AbortController().signal,identity:'fixture'};
  const denied=fixture(()=>response({code:0,req_0:{code:104401}}));assert.equal((await denied.protocols.refresh(snapshot,true)).outcome,'rejected');
  for(const data of [{musicid:456,musickey:'fixture-new-key'},{musicid:9007199254740992,musickey:'fixture-new-key'},{musicid:123},{musicid:123,musickey:'bad;value'}]){const f=fixture(()=>response({code:0,req_0:{code:0,data}}));await assert.rejects(f.protocols.refresh(snapshot,true),{code:'invalid-response'});assert.equal(f.calls.length,1);}
});
test('authorized Bilibili polling captures renewable credentials privately while missing tokens stay nonrenewable',async()=>{
  const f=fixture(()=>response({code:0,data:{code:0,refresh_token:'fixture-captured-refresh'}},{'set-cookie':setCookie(oldValues)})),login=new LoginProtocols(f.providers,{now:()=>10000});
  const answer=await login.poll({source:'bili',key:'fixture-key',id:'fixture',controller:new AbortController()});assert.equal(answer.credential.kind,'bili_web');assert.equal(answer.credential.refresh_token,'fixture-captured-refresh');assert.equal(answer.credential.expiresAt,10000+30*86400000);
});

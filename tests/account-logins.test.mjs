import test from 'node:test';
import assert from 'node:assert/strict';
import {AccountLogins} from '../server/account-logins.mjs';
import {PlatformError} from '../server/upstream.mjs';
const deferred=()=>{let resolve;return {promise:new Promise(done=>resolve=done),resolve:value=>resolve(value)};};
const session=()=>({id:Math.random().toString(),generation:0,accountRevision:'a'.repeat(32),cookies:{},accounts:{},expiry:1e9});
const input=(s,intent=1)=>({id:intent.toString(16).padStart(48,'0'),intent,revision:s.accountRevision});
function fixture(protocols={}) {
  let now=10000,commits=0,polls=0,valid=true;
  const login=new AccountLogins({providers:{},now:()=>now,ownsSession:()=>valid,protocols:{start:async()=>({url:'https://passport.bilibili.com/login?key=fixture'}),poll:async()=>{++polls;return {status:'waiting'};},profile:async()=>({name:'fixture'}),...protocols},install:(s,source,cookie)=>{++commits;s.cookies[source]=cookie;++s.generation;s.accountRevision='b'.repeat(32);login.clearSession(s.id);}});
  return {login,setNow:v=>now=v,invalidate:()=>valid=false,get commits(){return commits;},get polls(){return polls;}};
}
test('QR login polls are coalesced and limited; exactly one authorization commits',async()=>{
  const result=deferred();let calls=0;const f=fixture({poll:async()=>{++calls;return result.promise;}}),s=session();
  const qr=await f.login.start(s,'bili','qr',input(s));assert.equal(qr.status,'waiting');
  const a=f.login.poll(s,qr.id),b=f.login.poll(s,qr.id);assert.equal(calls,1);
  result.resolve({status:'authorized',cookie:'SESSDATA=fixture'});
  assert.equal((await a).status,'authorized');assert.equal((await b).status,'authorized');assert.equal(f.commits,1);
  assert.equal(f.login.records.size,0);assert.equal(s.cookies.bili,'SESSDATA=fixture');
  await assert.rejects(f.login.poll(s,qr.id),{code:'expired'});
});
test('waiting/scanned statuses enforce 2500 ms interval and terminal states clear private QR data',async()=>{
  const f=fixture(),s=session(),qr=await f.login.start(s,'bili','qr',input(s));
  await f.login.poll(s,qr.id);await f.login.poll(s,qr.id);assert.equal(f.polls,1);
  f.setNow(12500);f.login.protocols.poll=async()=>({status:'expired'});assert.equal((await f.login.poll(s,qr.id)).status,'expired');
  const record=f.login.records.get(qr.id);assert.equal(record.key,'');assert.equal(record.url,'');assert.equal(record.cookies,null);
});
test('cancel while authorizing, account change and session eviction each reject late authorization',async()=>{
  for(const cancel of [(f,s,qr)=>f.login.cancel(qr.id,s),(_f,s)=>++s.generation,(f)=>f.invalidate()]) {
    const d=deferred(),f=fixture({poll:()=>d.promise}),s=session(),qr=await f.login.start(s,'bili','qr',input(s));
    const pending=f.login.poll(s,qr.id).catch(e=>e);cancel(f,s,qr);d.resolve({status:'authorized',cookie:'SESSDATA=late'});
    assert.equal((await pending).code,'expired');assert.equal(f.commits,0);assert.deepEqual(s.cookies,{});
  }
});
test('a cancellation arriving before start rejects that intent, and 100 out-of-order starts keep only the newest',async()=>{
  const f=fixture(),s=session();f.login.cancel(input(s).id,s,input(s));await assert.rejects(f.login.start(s,'bili','qr',input(s)),{code:'expired'});
  const newest=await f.login.start(s,'bili','qr',input(s,102));
  const old=await Promise.all(Array.from({length:100},(_,i)=>f.login.start(s,'bili','qr',input(s,i+2)).catch(e=>e)));
  assert.ok(old.every(e=>e.code==='expired'));assert.deepEqual([...f.login.records.keys()],[newest.id]);
  await assert.rejects(f.login.start(s,'bili','qr',{...input(s,103),revision:'stale'}),{code:'session-changed'});
});
test('late QR creation cannot resurrect its image after cancellation or another login',async()=>{
  const d=deferred(),f=fixture({start:r=>r.source==='qq'?d.promise:Promise.resolve({url:'https://music.163.com/login'})}),s=session();
  const stale=f.login.start(s,'qq','qq',input(s)).catch(e=>e),record=f.login.records.get(input(s).id);
  const fresh=await f.login.start(s,'netease','qr',input(s,2));d.resolve({image:Buffer.from('private')});
  assert.equal((await stale).code,'expired');assert.equal(record.image,null);assert.equal(record.controller.signal.aborted,true);
  assert.deepEqual([...f.login.records.keys()],[fresh.id]);
});
test('images and cancellation are scoped to the owning session; login records expire and remain bounded',async()=>{
  const f=fixture({start:async()=>({image:Buffer.from('fixture-image')})}),s=session(),other=session(),qr=await f.login.start(s,'qq','qq',input(s));
  assert.equal(f.login.image(s,qr.id).toString(),'fixture-image');f.login.cancel(qr.id,other);
  assert.throws(()=>f.login.image(other,qr.id),{code:'expired'});assert.equal(f.login.records.size,1);
  for(let i=2;i<=40;i++){const next=session();await f.login.start(next,'qq','qq',input(next,i));}assert.equal(f.login.records.size,32);
  f.setNow(190001);f.login.prune();assert.equal(f.login.records.size,0);
});
test('profile verification distinguishes network error from expired credentials and rejects stale profiles',async()=>{
  const f=fixture(),s=session();s.cookies.bili='fixture';assert.equal((await f.login.verify(s,'bili')).accounts[1].status,'verified');
  f.login.protocols.profile=async()=>{throw new PlatformError('network','暂不可用',503);};assert.equal((await f.login.verify(s,'bili')).accounts[1].status,'check-failed');assert.equal(s.cookies.bili,'fixture');
  f.login.protocols.profile=async()=>{throw new PlatformError('sign-in','已失效',401);};assert.equal((await f.login.verify(s,'bili')).accounts[1].status,'expired');
  const d=deferred();f.login.protocols.profile=()=>d.promise;const stale=f.login.verify(s,'bili').catch(e=>e);++s.generation;d.resolve({name:'old'});assert.equal((await stale).code,'session-changed');
  assert.equal(f.login.checks.size,0);
});
test('public account states never contain cookies, user identifiers or private challenge keys',async()=>{
  const f=fixture({start:async r=>{r.key='fixture-private-key';r.cookies={fixture:'private-cookie'};return {url:'https://passport.bilibili.com/qr'};}}),s=session();s.cookies.bili='fixture-cookie';
  const qr=await f.login.start(s,'bili','qr',input(s));const publicText=JSON.stringify([qr,f.login.accounts(s)]);
  assert.doesNotMatch(publicText,/fixture-cookie|private-cookie|private-key/);
  for(const [source,method,args] of [['bad','qr',input(s,2)],['qq','qr',input(s,2)],['bili','qr',{id:'bad',intent:2,revision:s.accountRevision}]])await assert.rejects(f.login.start(s,source,method,args),{code:'invalid-request'});
});
test('verification rejected with an old token rereads a concurrent rotation without forcing a second renewal',async()=>{
  let reject,profiles=0,forced=0;const pending=new Promise((_,no)=>reject=no),f=fixture({profile:async()=>++profiles===1?pending:{name:'same-account'}}),s=session();s.cookies.bili='fixture-old';f.login.renewal={state:()=>({automaticRenewal:true}),renew:async(_s,_source,options)=>{if(options?.force)++forced;return 'healthy';}};
  const result=f.login.verify(s,'bili');for(let i=0;i<8;i++)await Promise.resolve();s.cookies.bili='fixture-new';reject(new PlatformError('sign-in','old token',401));assert.equal((await result).accounts[1].status,'verified');assert.equal(profiles,2);assert.equal(forced,0);
});

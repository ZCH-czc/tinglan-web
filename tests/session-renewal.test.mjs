import test from 'node:test';import assert from 'node:assert/strict';
import {SessionRenewal,RENEWAL_INTERVALS as ms} from '../server/session-renewal.mjs';
import {qqCredential} from '../server/session-credentials.mjs';
import {PlatformError} from '../server/upstream.mjs';
const deferred=()=>{let resolve;return {promise:new Promise(done=>resolve=done),resolve:v=>resolve(v)};};
const credential=(id='123',key='fixture-old-key')=>qqCredential({musicid:id,musickey:key,openid:'fixture-open',refresh_token:'fixture-refresh'},2,1000);
function fixture(refresh=async()=>({outcome:'healthy'}),confirm=async()=>{}){
  let now=10000,valid=true,calls=0,clears=0,starts=true;const timers=new Map();let next=0;const session={id:'fixture',cookies:{qq:'uin=123; qm_keyst=fixture-old-key'},generation:7,accountRevision:'a'.repeat(32)};
  const renewal=new SessionRenewal({providers:{net:{clearIdentity:()=>++clears}},now:()=>now,protocols:{refresh:async(...args)=>{++calls;return refresh(...args);},confirm},ownsSession:()=>valid,canStart:()=>starts,setTimer:(fn,delay)=>{const id=++next;timers.set(id,{fn,delay});return id;},clearTimer:id=>timers.delete(id)});
  renewal.install(session,'qq',credential());return {renewal,session,timers,advance:n=>now+=n,invalidate:()=>valid=false,setStarts:v=>starts=v,get calls(){return calls;},get clears(){return clears;}};
}
test('normal six-hour scheduling is coalesced across a burst of 100 refreshes',async()=>{
  const d=deferred(),f=fixture(()=>d.promise);assert.equal(f.timers.size,1);assert.equal(await f.renewal.renew(f.session,'qq'),'healthy');assert.equal(f.calls,0);f.advance(ms.healthy);
  const work=Array.from({length:100},()=>f.renewal.renew(f.session,'qq'));assert.ok(work.every(v=>v===work[0]));await Promise.resolve();assert.equal(f.calls,1);d.resolve({outcome:'healthy'});await Promise.all(work);assert.equal(f.timers.size,1);assert.equal(f.renewal.state(f.session,'qq').renewalStatus,'healthy');
});
test('same-account rotation preserves navigation/account identity and updates request auth ownership',async()=>{
  const f=fixture(async()=>({outcome:'refreshed',credential:credential('123','fixture-new-key'),cookie:'uin=123; qm_keyst=fixture-new-key'}));
  assert.equal(await f.renewal.renew(f.session,'qq',{force:true}),'refreshed');assert.match(f.session.cookies.qq,/new-key/);assert.equal(f.session.generation,7);assert.equal(f.session.accountRevision,'a'.repeat(32));assert.equal(f.session.authRevision,1);assert.equal(f.clears,1);
  await f.renewal.renew(f.session,'qq',{force:true});assert.equal(f.calls,1);
});
test('logout, replacement, eviction and cookie replacement each reject a delayed rotation',async()=>{
  for(const action of [f=>f.renewal.clearSource(f.session,'qq'),f=>f.renewal.install(f.session,'qq',credential()),f=>f.invalidate(),f=>f.session.cookies.qq='uin=456; qm_keyst=other-key']){
    const d=deferred(),f=fixture(()=>d.promise),pending=f.renewal.renew(f.session,'qq',{force:true});await Promise.resolve();action(f);d.resolve({outcome:'refreshed',credential:credential('123','fixture-new-key'),cookie:'uin=123; qm_keyst=fixture-new-key'});assert.equal(await pending,'superseded');assert.equal(f.session.authRevision,undefined);assert.doesNotMatch(f.session.cookies.qq,/new-key/);
  }
});
test('network failures preserve credentials and back off instead of deleting an account',async()=>{
  const f=fixture(async()=>{throw new TypeError('private upstream URL');});assert.equal(await f.renewal.renew(f.session,'qq',{force:true}),'unavailable');assert.match(f.session.cookies.qq,/old-key/);assert.doesNotMatch(JSON.stringify(f.renewal.state(f.session,'qq')),/private upstream/);await f.renewal.renew(f.session,'qq');assert.equal(f.calls,1);f.advance(ms.unavailable);await f.renewal.renew(f.session,'qq');assert.equal(f.calls,2);
});
test('verification cooldown and rejected credentials resist forced refresh bursts',async()=>{
  for(const failure of [new PlatformError('verification','private',429,120),null]){
    const f=fixture(async()=>{if(failure)throw failure;return {outcome:'rejected'};});assert.equal(await f.renewal.renew(f.session,'qq',{force:true}),failure?'deferred':'rejected');
    f.advance(61000);for(let i=0;i<40;i++)await f.renewal.renew(f.session,'qq',{force:true});assert.equal(f.calls,1);assert.match(f.session.cookies.qq,/old-key/);
  }
});
test('same-account guard rejects a backend that returns another account even with valid credentials',async()=>{
  const f=fixture(async()=>({outcome:'refreshed',credential:credential('456','fixture-new-key'),cookie:'uin=456; qm_keyst=fixture-new-key'}));assert.equal(await f.renewal.renew(f.session,'qq',{force:true}),'unavailable');assert.match(f.session.cookies.qq,/uin=123/);assert.equal(f.clears,0);
});
test('a platform mutation defers background rotation and missing credentials create no timer',async()=>{
  const f=fixture();f.setStarts(false);f.advance(ms.healthy);assert.equal(await f.renewal.renew(f.session,'qq'),'deferred');assert.equal(f.calls,0);f.setStarts(true);f.advance(ms.force);await f.renewal.renew(f.session,'qq');assert.equal(f.calls,1);f.renewal.clearSession(f.session.id);assert.equal(f.timers.size,0);f.renewal.install(f.session,'qq',null);assert.equal(f.timers.size,0);assert.equal(await f.renewal.renew(undefined,'qq'),'missing');
});
test('Bilibili publishes new credentials before confirmation and retries only the pending confirmation',async()=>{
  let fail=true,refreshes=0,confirms=0;const f=fixture();f.renewal.clearSession(f.session.id);f.session.cookies.bili='DedeUserID=123; SESSDATA=old';
  const old={kind:'bili_web',userId:'123',refresh_token:'old-refresh'},fresh={...old,refresh_token:'new-refresh',pendingConfirm:'old-refresh'};
  f.renewal.protocols={refresh:async snapshot=>{++refreshes;if(snapshot.credential.pendingConfirm){await f.renewal.protocols.confirm(snapshot);return {outcome:'confirmed'};}return {outcome:'refreshed',credential:{...fresh},cookie:'DedeUserID=123; SESSDATA=new'};},confirm:async snapshot=>{++confirms;assert.equal(f.session.cookies.bili,'DedeUserID=123; SESSDATA=new');assert.equal(snapshot.credential.refresh_token,'new-refresh');if(fail)throw new Error('network');}};
  f.renewal.install(f.session,'bili',old);assert.equal(await f.renewal.renew(f.session,'bili',{force:true}),'unavailable');assert.match(f.session.cookies.bili,/SESSDATA=new/);assert.equal(f.session.authRevision,1);fail=false;f.advance(ms.unavailable);assert.equal(await f.renewal.renew(f.session,'bili'),'refreshed');assert.equal(refreshes,2);assert.equal(confirms,2);assert.equal(f.session.authRevision,1);assert.doesNotMatch(JSON.stringify(f.renewal.state(f.session,'bili')),/old-refresh|new-refresh|SESSDATA/);
});
test('logging out before a queued renewal starts sends no upstream request',async()=>{
  const f=fixture();const pending=f.renewal.renew(f.session,'qq',{force:true});f.renewal.clearSession(f.session.id);assert.equal(await pending,'superseded');assert.equal(f.calls,0);assert.equal(f.timers.size,0);
});
test('an expired owner drops its renewable credential and timer without another platform request',async()=>{
  const f=fixture();f.invalidate();const timer=[...f.timers.values()][0];f.timers.clear();timer.fn();for(let i=0;i<8;i++)await Promise.resolve();assert.equal(f.renewal.records.size,0);assert.equal(f.calls,0);assert.equal(f.timers.size,0);
});

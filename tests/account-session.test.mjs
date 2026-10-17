import test from 'node:test';
import assert from 'node:assert/strict';
import {AccountSession} from '../web/account-session.mjs';
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
function fixture(request) {
  let now=10000,hidden=false,serial=0,connected=0;const timers=new Map(),calls=[],images=[];
  const platform={accountRevision:'a'.repeat(32),refreshAccounts:async()=>({accounts:[]}),request:async(path,options)=>{calls.push({path,...options});if(request)return request(path,options);if(path==='/api/login/start')return {...options.body,expiresAt:now+180000,url:'https://fixture.test/qr'};return {status:'waiting'};}};
  const auth=new AccountSession({platform,encode:async()=>['101','010','101'],deliverImage:async(...args)=>images.push(args),connected:async()=>++connected,now:()=>now,hidden:()=>hidden,setTimer:(fn)=>{timers.set(++serial,fn);return serial;},clearTimer:id=>timers.delete(id),nonce:()=> (++serial).toString(16).padStart(48,'0')});
  return {auth,platform,calls,images,timers,setNow:v=>now=v,setHidden:v=>hidden=v,get connected(){return connected;}};
}
test('one visible scan loop pauses in background, resumes without overlap and expires without another request',async()=>{
  const f=fixture();await f.auth.start('bili');assert.equal(f.auth.state.status,'waiting');assert.equal(f.timers.size,1);
  f.setHidden(true);f.auth.visibility();assert.equal(f.timers.size,0);await f.auth.poll();assert.equal(f.calls.length,1);
  f.setHidden(false);f.auth.visibility();await new Promise(r=>setImmediate(r));assert.equal(f.calls.filter(x=>x.path.endsWith('/poll')).length,1);assert.equal(f.timers.size,1);
  f.setNow(200001);await f.auth.poll();assert.equal(f.auth.state.status,'expired');assert.equal(f.calls.filter(x=>x.path.endsWith('/poll')).length,1);assert.equal(f.auth.state.qrRows.length,0);f.auth.close();
});
test('closing or switching while a poll is pending rejects stale success and allows the new login to poll',async()=>{
  const d=deferred();let polls=0;const f=fixture((path,{body})=>path.endsWith('/start')?{...body,expiresAt:200000,url:'https://fixture.test/qr'}:path.endsWith('/poll')?(++polls===1?d.promise:{status:'scanned'}):{});
  await f.auth.start('bili');const stale=f.auth.poll();await f.auth.start('netease');await f.auth.poll();assert.equal(f.auth.state.status,'scanned');
  d.resolve({status:'authorized'});await stale;assert.equal(f.connected,0);assert.equal(f.auth.state.source,'netease');assert.equal(f.auth.pending,false);assert.equal(f.timers.size,1);f.auth.close();
});
test('100 fast login selections only publish the latest QR; old starts are cancelled using their original intent',async()=>{
  const starts=[],f=fixture((path,{body})=>{if(path.endsWith('/start')){const d=deferred();starts.push({...d,body});return d.promise;}return {};});
  const jobs=[];for(let i=0;i<100;i++)jobs.push(f.auth.start(i===99?'netease':'bili'));
  for(const s of [...starts].reverse())s.resolve({...s.body,expiresAt:200000,url:'https://fixture.test/qr'});await Promise.all(jobs);
  assert.equal(f.auth.state.source,'netease');assert.equal(f.auth.state.status,'waiting');assert.equal(f.timers.size,1);
  const cancelled=f.calls.filter(x=>x.path.endsWith('/cancel'));assert.ok(cancelled.length>=99);assert.ok(cancelled.every(x=>x.body.intent>0 && x.body.revision===f.platform.accountRevision));f.auth.close();
});
test('late QQ bitmap delivery is removed and cannot replace another platform QR',async()=>{
  const d=deferred(),f=fixture((path,{body})=>path.endsWith('/start')?{...body,expiresAt:200000,...(body.source==='qq'?{imagePath:'/api/login/image?id='+body.id}:{url:'https://fixture.test/qr'})}:{});
  f.auth.deliverImage=async(key,path)=>{f.images.push([key,path]);if(path)await d.promise;};
  const old=f.auth.start('qq');await new Promise(r=>setImmediate(r));await f.auth.start('bili');d.resolve();await old;
  assert.equal(f.auth.state.source,'bili');assert.equal(f.auth.state.imageKey,'');assert.ok(f.images.some(([key,path])=>key.startsWith('login-qr-') && path===null));f.auth.close();
});
test('authorized state remains committed if later account refresh fails, and terminal failures never retry automatically',async()=>{
  const f=fixture((path,{body})=>path.endsWith('/start')?{...body,expiresAt:200000,url:'https://fixture.test/qr'}:{status:'authorized'});
  await f.auth.start('bili');f.platform.refreshAccounts=async()=>{throw new Error('offline');};await f.auth.poll();assert.equal(f.auth.state.status,'authorized');assert.match(f.auth.state.error,/Authorized/i);assert.equal(f.timers.size,0);assert.equal(f.auth.attempt,null);f.auth.close();
  const g=fixture((path,{body})=>path.endsWith('/start')?{...body,expiresAt:200000,url:'https://fixture.test/qr'}:Promise.reject(new Error('verification')));
  await g.auth.start('bili');await g.auth.poll();assert.equal(g.auth.state.status,'error');assert.equal(g.timers.size,0);await g.auth.poll();assert.equal(g.calls.filter(x=>x.path.endsWith('/poll')).length,1);g.auth.close();
});

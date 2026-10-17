import test from 'node:test';import assert from 'node:assert/strict';
import {WebDavClient} from '../web/webdav-handoff.mjs';
const now=1700000000000,snapshot=()=>({sessionId:'relay-session',deviceId:'android',deviceName:'车机',updatedAt:now,tracks:[{id:'qq:track:001AbCdefghij',title:'海风',artist:'听岚',duration:100}],index:0,positionMs:12345});
const state=()=>({connected:true,configRevision:'b'.repeat(32),intent:1,configuration:{endpoint:'https://storage.test/dav/',username:'fixture-user',deviceName:'浏览器',deviceId:'web'},remote:{snapshot:snapshot(),token:'c'.repeat(32)},needsRefresh:false});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(extra={}) {
  const calls=[],events=[],platform={generation:0,accountRevision:'a'.repeat(32),request:async(path,options)=>{calls.push({path,options});return state();}};let seq=0;
  const client=new WebDavClient({platform,deviceId:'web',now:()=>now,changed:s=>events.push(s),capture:()=>({id:'original'}),operationId:()=>String(++seq).padStart(48,'0'),sessionId:()=> 'web-session',outgoing:()=>({...snapshot(),deviceId:'web',deviceName:'浏览器'}),...extra});return {client,platform,calls,events};
}
test('first open reads connection/remote once and returning to the page reuses accepted state',async()=>{
  const f=fixture();await f.client.open();assert.deepEqual(f.calls.map(row=>row.path),['/api/webdav','/api/webdav/refresh']);f.client.close();await f.client.open();assert.equal(f.calls.length,2);await f.client.refresh();assert.equal(f.calls.length,4);
  const view=f.client.view();assert.equal(view.remoteTitle,'海风');assert.equal(view.canReceive,true);assert.doesNotMatch(JSON.stringify(view),/tracks|remoteToken|password|c{32}/);
});
test('connect binds local device and revisions without persisting its password in state or view',async()=>{
  const f=fixture();await f.client.open();await f.client.connect({endpoint:'https://storage.test/dav/',username:'fixture-user',password:'fixture-only',deviceName:'浏览器'});
  const call=f.calls.at(-1);assert.equal(call.path,'/api/webdav/connect');assert.equal(call.options.body.deviceId,'web');assert.equal(call.options.body.revision,'a'.repeat(32));assert.equal(call.options.body.intent,2);assert.equal(call.options.body.password,'fixture-only');assert.doesNotMatch(JSON.stringify(f.client.state),/fixture-only|password/);
});
test('100 rapid publish clicks issue one POST and pause only after a confirmed write',async()=>{
  const wait=deferred(),paused=[],f=fixture({published:(snap,owner)=>{paused.push({snap,owner});return true;}});await f.client.open();f.platform.request=async(path,options)=>{f.calls.push({path,options});return path.endsWith('/publish')?wait.promise:state();};
  const jobs=Array.from({length:100},()=>f.client.publish());assert.equal(f.calls.filter(row=>row.path.endsWith('/publish')).length,1);assert.equal(paused.length,0);assert.equal(f.client.state.busy,true);
  wait.resolve({...state(),written:true,snapshot:{...snapshot(),deviceId:'web',deviceName:'浏览器'}});await Promise.all(jobs);assert.equal(paused.length,1);assert.equal(paused[0].owner.id,'original');assert.match(f.client.state.notice,/Local playback paused/i);
});
test('network failure or a conflict never pauses the source and requires explicit refresh before another submission',async()=>{
  const paused=[],f=fixture({published:()=>paused.push(1)});await f.client.open();f.platform.request=async(path,options)=>{f.calls.push({path,options});if(path.endsWith('/publish'))throw Object.assign(new Error('其他设备已更新'),{code:'conflict'});return state();};
  await f.client.publish();assert.equal(paused.length,0);assert.equal(f.client.state.needsRefresh,true);for(let i=0;i<100;i++)await f.client.publish();assert.equal(f.calls.filter(row=>row.path.endsWith('/publish')).length,1);await f.client.refresh();assert.equal(f.client.state.needsRefresh,false);
});
test('a confirmed PUT remains confirmed when the subsequent refresh fails, and a changed local player is preserved',async()=>{
  const paused=[],f=fixture({published:()=>{paused.push(1);return false;}});await f.client.open();f.platform.request=async path=>{if(path.endsWith('/publish'))return {...state(),written:true,snapshot:snapshot()};throw new Error('read unavailable');};
  await f.client.publish();assert.equal(paused.length,1);assert.match(f.client.state.notice,/changed local playback is kept/i);assert.match(f.client.state.warning,/Handoff saved/i);assert.equal(f.client.state.needsRefresh,true);
});
test('closing a page during a write preserves its confirmation, while account changes discard it',async()=>{
  const wait=deferred(),paused=[],f=fixture({published:()=>paused.push(1)});await f.client.open();f.platform.request=async path=>path.endsWith('/publish')?wait.promise:state();const work=f.client.publish();f.client.close();wait.resolve({...state(),written:true,snapshot:snapshot()});await work;assert.equal(paused.length,1);
  const stale=deferred();f.platform.request=async()=>stale.promise;const old=f.client.publish();++f.platform.generation;f.platform.accountRevision='d'.repeat(32);f.client.clear();stale.resolve({...state(),written:true,snapshot:snapshot()});await old;assert.equal(paused.length,1);assert.equal(f.client.state.connected,false);
});
test('claim prepares first, keeps old playback until server confirmation, then applies the exact position and queue',async()=>{
  const wait=deferred(),prepared=[],applied=[],f=fixture({prepare:async plan=>prepared.push(plan),continueHere:async(plan,owner)=>{applied.push({plan,owner});return true;}});await f.client.open();f.platform.request=async path=>path.endsWith('/claim')?wait.promise:state();const work=f.client.claim();await tick();assert.equal(prepared.length,1);assert.equal(applied.length,0);
  wait.resolve({...state(),written:true,snapshot:{...snapshot(),deviceId:'web'}});await work;assert.equal(applied[0].plan.currentId,'qq-001AbCdefghij');assert.equal(applied[0].plan.position,12345);assert.equal(applied[0].owner.id,'original');assert.equal(f.client.state.pendingResume,false);assert.match(f.client.state.notice,/loaded/i);
});
test('a refused claim never applies playback, and local capacity is checked before issuing the PUT',async()=>{
  const applied=[],f=fixture({continueHere:async()=>applied.push(1)});await f.client.open();f.platform.request=async path=>{if(path.endsWith('/claim'))throw new Error('conflict');return state();};await f.client.claim();assert.equal(applied.length,0);
  const g=fixture({prepare:async()=>{throw new Error('capacity');},continueHere:()=>assert.fail('capacity failure changed player')});await g.client.open();await g.client.claim();assert.equal(g.calls.filter(row=>row.path.endsWith('/claim')).length,0);assert.match(g.client.state.warning,/capacity/);
});
test('a successful claim with local storage failure can resume locally without a second claim PUT',async()=>{
  let failed=true,claims=0,applied=0;const f=fixture({continueHere:async()=>{if(failed)throw new Error('quota');++applied;return true;}});await f.client.open();f.platform.request=async path=>{if(path.endsWith('/claim')){++claims;return {...state(),written:true,snapshot:snapshot()};}return state();};
  await f.client.claim();assert.equal(f.client.state.pendingResume,true);assert.match(f.client.state.notice,/received/i);assert.match(f.client.state.warning,/quota/);failed=false;await f.client.resumeReceived();assert.equal(claims,1);assert.equal(applied,1);assert.equal(f.client.state.pendingResume,false);
});
test('a changed local playback after claim stays untouched and can be resumed by a new explicit user action',async()=>{
  let same=false,captures=0;const f=fixture({capture:()=>({id:String(++captures)}),continueHere:async()=>same});await f.client.open();f.platform.request=async path=>path.endsWith('/claim')?{...state(),written:true,snapshot:snapshot()}:state();await f.client.claim();assert.equal(f.client.state.pendingResume,true);same=true;await f.client.resumeReceived();assert.equal(captures,2);assert.equal(f.client.state.pendingResume,false);
});
test('cancelled reads and 100 rapid page opens never publish a stale configuration',async()=>{
  const requests=[],f=fixture();f.platform.request=(_path,options)=>{const d=deferred();requests.push({...d,options});return d.promise;};
  const jobs=Array.from({length:100},()=>{const job=f.client.open();f.client.close();return job;});assert.equal(requests.length,100);assert.ok(requests.every(row=>row.options.signal.aborted));for(const request of requests)request.resolve(state());await Promise.all(jobs);assert.equal(f.client.state.connected,false);assert.equal(f.client.state.busy,false);
});
test('expired records cannot claim, duplicate queues keep their exact occurrence, and forgetting clears receipts',async()=>{
  const f=fixture();await f.client.open();f.client.state.remote.snapshot.updatedAt=now-8*86400000;assert.equal(await f.client.claim(),false);assert.equal(f.client.view().remoteExpired,true);
  const duplicate={...snapshot(),tracks:[snapshot().tracks[0],snapshot().tracks[0]],index:1},applied=[];
  f.client.state.remote.snapshot=duplicate;assert.equal(f.client.view().canReceive,true);assert.equal(f.client.view().incomingIssue,'');
  f.client.continueHere=async plan=>{applied.push(plan);return true;};
  f.platform.request=async(path,options)=>{f.calls.push({path,options});return path.endsWith('/claim')?{...state(),written:true,snapshot:duplicate}:state();};
  assert.equal(await f.client.claim(),true);assert.equal(f.calls.filter(row=>row.path.endsWith('/claim')).length,1);assert.equal(applied.length,1);assert.equal(applied[0].ids.length,2);assert.equal(applied[0].index,1);assert.equal(applied[0].metadata.length,1);
  f.platform.request=async()=>({...state(),connected:false,configuration:null,remote:null,configRevision:'d'.repeat(32)});await f.client.forget();assert.equal(f.client.state.connected,false);assert.equal(f.client.pendingSnapshot,null);
});

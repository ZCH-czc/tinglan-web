import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserPlayback} from '../web/playback.mjs';
import {PlaybackRecovery,playbackFailure,retryAfterSeconds} from '../web/playback-recovery.mjs';
import {playbackTask} from '../web/playback-task.mjs';

const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

test('pause while audio processing prepares cannot start native playback later',async()=>{
  const c=setup();let complete;const ready=new Promise(resolve=>complete=resolve);c.host.beforePlay=()=>ready;const pending=c.host.switchTo('a');await flush();c.host.pause();complete();await pending;assert.equal(c.audio.paused,true);assert.equal(c.host.desiredPlaying,false);c.host.dispose();
});
test('old audio preparation cannot start a newer paused track',async()=>{
  const c=setup({queue:['a','b']});let complete;const ready=new Promise(resolve=>complete=resolve);c.host.beforePlay=()=>ready;const old=c.host.switchTo('a');await flush();await c.host.switchTo('b',{play:false});complete();await old;assert.equal(c.engine.currentId(),'b');assert.equal(c.audio.paused,true);c.host.dispose();
});
class Clock {
  now=1000;serial=0;tasks=new Map();
  setTimeout=(fn,ms)=>{const id=++this.serial;this.tasks.set(id,{fn,at:this.now+ms});return id;};
  clearTimeout=id=>this.tasks.delete(id);
  async advance(ms){const end=this.now+ms;for(;;){const next=[...this.tasks].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;this.now=next[1].at;this.tasks.delete(next[0]);next[1].fn();await flush();}this.now=end;await flush();}
}
class Audio extends EventTarget {
  src='';currentTime=0;duration=120;readyState=0;paused=true;playbackRate=1;error=null;hang=false;
  setAttribute(){}removeAttribute(){this.src='';}
  load(){this.currentTime=0;this.error=null;this.readyState=this.src && !this.hang?1:0;}
  pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}
  async play(){if(this.hang)return new Promise(()=>{});this.paused=false;this.dispatchEvent(new Event('playing'));}
  fail(code){this.error={code};this.dispatchEvent(new Event('error'));}
  tick(seconds){this.currentTime=seconds;this.dispatchEvent(new Event('timeupdate'));}
}
function setup({queue=['a'],source,diagnose,local=false}={}) {
  const clock=new Clock(),audio=new Audio(),events=new EventTarget(),errors=[],states=[],tracks=[],reads=[],notices=[];let online=true,index=0,position=0,begins=0,ends=0;
  const engine={selectTrack(id){const at=queue.indexOf(id);if(at<0)return false;if(queue[index]!==id){index=at;position=0;}return true;},currentId:()=>queue[index],currentTrackJson:()=>JSON.stringify({id:queue[index],title:queue[index],artist:'Fixture',source:local?'local':'qq'}),setPosition:ms=>position=Math.max(0,Math.min(120000,ms)),positionMs:()=>position,currentQueueIndex:()=>index,queueSize:()=>queue.length,currentQueueKey:()=>`entry-${index}`,nextTrack:automatic=>{if(automatic && index+1===queue.length)return '';index=(index+1)%queue.length;position=0;return queue[index];},previousTrack:()=>queue[index=Math.max(0,index-1)]};
  const store={sourceFor(id,signal){reads.push({id,signal});return source?source(id,signal,reads.length):Promise.resolve({url:'/api/media/'+String(reads.length).padStart(48,'0')});},diagnose};
  const host=new BrowserPlayback(engine,store,{metadata:()=>JSON.parse(engine.currentTrackJson()),state:s=>states.push(s),track:id=>tracks.push(id),error:e=>errors.push(e),notice:s=>notices.push(s),time(){},duration(){},listeningBegin:()=>begins++,listeningEnd:()=>ends++},{audio,events,online:()=>online,now:()=>clock.now,setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout});
  return {host,audio,events,clock,errors,states,tracks,reads,notices,engine,setOnline:value=>online=value,setIndex:value=>index=value,stats:()=>({begins,ends})};
}
async function fault(c,code=2){c.audio.fail(code);await flush();}

test('classifies standard media errors, rights, verification, expired grants and offline hints distinctly',()=>{
  assert.equal(playbackFailure({}, {mediaCode:2,offline:true}).kind,'offline');
  assert.equal(playbackFailure({}, {mediaCode:3}).kind,'terminal');
  assert.equal(playbackFailure({}, {mediaCode:4}).kind,'terminal');
  assert.equal(playbackFailure({code:'expired',status:410},{mediaCode:4}).kind,'recoverable');
  for(const code of ['rights','sign-in','verification','cooldown','session-changed'])assert.equal(playbackFailure({code}).kind,'restricted');
  assert.equal(playbackFailure({}, {mediaCode:2,offline:true,local:true}).kind,'terminal');
  assert.equal(playbackFailure({name:'NotAllowedError'}).kind,'gesture');
});
test('parses bounded Retry-After seconds and HTTP dates',()=>{
  assert.equal(retryAfterSeconds('600'),120);assert.equal(retryAfterSeconds('0'),0);assert.equal(retryAfterSeconds('garbage'),0);
  assert.equal(retryAfterSeconds('Thu, 15 Oct 2026 10:00:30 GMT',Date.parse('2026-10-15T10:00:00Z')),30);
  assert.equal(retryAfterSeconds('Thu, 15 Oct 2026 09:59:00 GMT',Date.parse('2026-10-15T10:00:00Z')),0);
});
test('policy bounds an unsuccessful chain and never treats repeated playing events as recovery',()=>{
  const policy=new PlaybackRecovery(),failure={kind:'recoverable'};
  for(let i=0;i<4;i++){assert.equal(policy.decide(String(i),failure,{playing:true,hasNext:true}),i<3?'refresh':'stop');assert.equal(policy.decide(String(i),failure,{playing:true,hasNext:true}),i<3?'skip':'stop');}
  assert.equal(policy.skipped,3);assert.equal(policy.resumeNetwork(),true);assert.equal(policy.resumeNetwork(),false);
  policy.reset();assert.equal(policy.skipped,0);assert.equal(policy.decide('a',{kind:'restricted'},{playing:true,hasNext:true}),'stop');
});
test('a task deadline settles ignored abort signals and discards late results',async()=>{
  const clock=new Clock(),controller=new AbortController();let resolve;
  const task=playbackTask(()=>new Promise(r=>resolve=r),{signal:controller.signal,timeoutMs:20,timers:clock});
  const rejected=assert.rejects(task,e=>e.code==='source-timeout');await clock.advance(20);await rejected;resolve('late');await flush();assert.equal(clock.tasks.size,0);
});
test('task cancellation settles immediately and clears its deadline',async()=>{
  const clock=new Clock(),controller=new AbortController(),task=playbackTask(()=>new Promise(()=>{}),{signal:controller.signal,timeoutMs:100,timers:clock});
  const rejected=assert.rejects(task,e=>e.name==='AbortError');controller.abort();await rejected;assert.equal(clock.tasks.size,0);
});
test('expired grant recovery preserves position, queue occurrence, metadata and the listening session',async()=>{
  const c=setup({queue:['a','a','b'],diagnose:async()=>({failure:{code:'expired',status:410}})});c.setIndex(1);await c.host.switchTo('a');c.audio.tick(23);const stats=c.stats();
  await fault(c,4);assert.equal(c.host.status,'buffering');await c.clock.advance(750);
  assert.equal(c.reads.length,2);assert.equal(c.audio.currentTime,23);assert.equal(c.engine.currentQueueKey(),'entry-1');assert.deepEqual(c.tracks,['a']);assert.deepEqual(c.stats(),stats);assert.equal(c.host.status,'playing');c.host.dispose();
});
test('a missing companion token reported by the diagnostic endpoint is also refreshed once',async()=>{
  const c=setup({diagnose:async()=>{throw Object.assign(new Error('expired'),{code:'expired',status:410});}});await c.host.switchTo('a');await fault(c,4);await c.clock.advance(750);assert.equal(c.reads.length,2);assert.equal(c.host.status,'playing');c.host.dispose();
});
test('rights and verification diagnostics stop without any new address resolution',async()=>{
  for(const code of ['rights','verification']){const c=setup({queue:['a','b'],diagnose:async()=>({failure:{code,status:code==='rights'?401:429,retryAfter:60,message:'权限或验证提示'}})});await c.host.switchTo('a');await fault(c,4);await c.clock.advance(120000);assert.equal(c.reads.length,1);assert.equal(c.host.status,'error');assert.equal(c.engine.currentId(),'a');assert.match(c.errors[0],/权限或验证提示/);c.host.dispose();}
});
test('manual retry obeys a server cooldown before making a new platform request',async()=>{
  const c=setup({source:(_id,_signal,count)=>count===1?Promise.reject(Object.assign(new Error('平台需要冷却'),{code:'verification',status:429,retryAfter:60})):Promise.resolve({url:'/api/media/'+String(count).padStart(48,'0')})});
  await c.host.switchTo('a');assert.equal(await c.host.retry(),false);assert.equal(c.reads.length,1);await c.clock.advance(60000);await c.host.retry();assert.equal(c.reads.length,2);assert.equal(c.host.status,'playing');c.host.dispose();
});
test('an unsuccessful chain refreshes each song once and advances at most three entries',async()=>{
  const c=setup({queue:['a','b','c','d','e']});await c.host.switchTo('a');
  for(let i=0;i<4;i++){await fault(c);await c.clock.advance(750);await fault(c);await c.clock.advance(750);}
  assert.equal(c.reads.length,7);assert.deepEqual(c.tracks,['a','b','c','d']);assert.equal(c.host.status,'error');assert.equal(c.engine.currentId(),'d');assert.equal(c.clock.tasks.size,0);assert.match(c.errors.at(-1),/Automatic retries stopped/i);c.host.dispose();
});
test('sustained advancing playback replenishes the recovery budget',async()=>{
  const c=setup();await c.host.switchTo('a');await fault(c);await c.clock.advance(750);await c.clock.advance(20001);c.audio.tick(25);
  await fault(c);await c.clock.advance(750);assert.equal(c.reads.length,3);assert.equal(c.host.status,'playing');c.host.dispose();
});
test('pause during recovery backoff prevents a new source request',async()=>{
  const c=setup();await c.host.switchTo('a');await fault(c);c.host.pause();await c.clock.advance(1000);assert.equal(c.reads.length,1);assert.equal(c.host.status,'paused');assert.equal(c.audio.paused,true);assert.equal(c.clock.tasks.size,0);c.host.dispose();
});
test('pause aborts a diagnostic and its late rights result cannot overwrite the paused state',async()=>{
  let resolve,signal;const c=setup({diagnose:(_url,s)=>{signal=s;return new Promise(r=>resolve=r);}});await c.host.switchTo('a');c.audio.fail(2);c.host.pause();assert.equal(signal.aborted,true);resolve({failure:{code:'rights',status:401}});await flush();assert.equal(c.host.status,'paused');assert.equal(c.errors.length,0);c.host.dispose();
});
test('switching songs invalidates an old diagnostic completion',async()=>{
  let resolve;const c=setup({queue:['a','b'],diagnose:()=>new Promise(r=>resolve=r)});await c.host.switchTo('a');c.audio.fail(2);await c.host.switchTo('b');resolve({failure:{code:'rights',status:401}});await flush();assert.equal(c.host.trackId,'b');assert.equal(c.host.status,'playing');assert.equal(c.errors.length,0);c.host.dispose();
});
test('late address recovery cannot replace a newer selected song',async()=>{
  let resolve,oldSignal;const c=setup({queue:['a','b'],source:(id,signal,count)=>count===2?(oldSignal=signal,new Promise(r=>resolve=r)):Promise.resolve({url:'/api/media/'+id.repeat(48)})});
  await c.host.switchTo('a');await fault(c);await c.clock.advance(750);await c.host.switchTo('b');const url=c.audio.src;assert.equal(oldSignal.aborted,true);resolve({url:'/api/media/'+''.padStart(48,'9')});await flush();assert.equal(c.audio.src,url);assert.equal(c.host.trackId,'b');c.host.dispose();
});
test('network failure waits without polling, then resumes the exact position on a real online event',async()=>{
  const c=setup();await c.host.switchTo('a');c.audio.tick(31);c.setOnline(false);await fault(c);assert.equal(c.host.status,'waiting-network');assert.equal(c.host.desiredPlaying,true);assert.equal(c.clock.tasks.size,0);
  await c.clock.advance(120000);assert.equal(c.reads.length,1);c.setOnline(true);c.events.dispatchEvent(new Event('online'));await flush();assert.equal(c.reads.length,2);assert.equal(c.audio.currentTime,31);assert.equal(c.host.status,'playing');c.host.dispose();
});
test('offline wait can be cancelled and online event storms cannot restart paused music',async()=>{
  const c=setup();await c.host.switchTo('a');c.setOnline(false);await fault(c);c.host.pause();for(let i=0;i<100;i++)c.events.dispatchEvent(new Event('online'));await flush();assert.equal(c.reads.length,1);assert.equal(c.audio.paused,true);assert.equal(c.host.status,'paused');c.host.dispose();
});
test('offline status does not block cached/local audio or interrupt buffered playback',async()=>{
  let diagnostics=0;const c=setup({local:true,source:async()=>new Blob(['local']),diagnose:async()=>{diagnostics++;}});c.setOnline(false);await c.host.switchTo('a');c.events.dispatchEvent(new Event('offline'));c.audio.dispatchEvent(new Event('stalled'));c.audio.readyState=4;c.audio.tick(1);await c.clock.advance(60000);assert.equal(c.host.status,'playing');assert.equal(c.reads.length,1);assert.equal(diagnostics,0);c.host.dispose();
});
test('corrupt cached bytes produce a format message without deletion, CDN probes or automatic skip',async()=>{
  let diagnoses=0;const c=setup({queue:['a','b'],source:async()=>new Blob(['corrupt']),diagnose:async()=>{diagnoses++;}});await c.host.switchTo('a');await fault(c,3);await c.clock.advance(60000);assert.equal(c.reads.length,1);assert.equal(diagnoses,0);assert.equal(c.engine.currentId(),'a');assert.match(c.errors[0],/Unable to decode this local or cached audio/i);c.host.dispose();
});
test('repeated waiting events cannot postpone the buffer watchdog forever',async()=>{
  const c=setup();await c.host.switchTo('a');c.audio.dispatchEvent(new Event('waiting'));for(let i=0;i<5;i++){await c.clock.advance(5000);c.audio.dispatchEvent(new Event('waiting'));}await c.clock.advance(5000);assert.match(c.host.notice,/Buffering/i);await c.clock.advance(750);assert.equal(c.reads.length,2);c.host.dispose();
});
test('a permanently pending native play is released by the watchdog and final recovery budget',async()=>{
  const c=setup();c.audio.hang=true;const first=c.host.switchTo('a');await flush();await c.clock.advance(30000);assert.equal(await first,false);await c.clock.advance(30750);assert.equal(c.reads.length,2);assert.equal(c.host.status,'error');assert.equal(c.clock.tasks.size,0);c.host.dispose();
});
test('a source adapter that ignores its abort cannot keep loading or publish a late source',async()=>{
  let resolve;const c=setup({source:(_id,_signal,count)=>count===1?new Promise(r=>resolve=r):Promise.resolve({url:'/api/media/'+'2'.repeat(48)})});const first=c.host.switchTo('a');await c.clock.advance(20000);assert.equal(await first,false);await c.clock.advance(750);const url=c.audio.src;resolve({url:'/api/media/'+'1'.repeat(48)});await flush();assert.equal(c.audio.src,url);assert.equal(c.host.status,'playing');c.host.dispose();
});
test('seek during connection diagnosis is applied to the repaired source',async()=>{
  let resolve;const c=setup({diagnose:()=>new Promise(r=>resolve=r)});await c.host.switchTo('a');c.audio.tick(33);c.audio.fail(2);c.host.seek(12000);resolve({failure:{code:'expired',status:410}});await flush();await c.clock.advance(750);assert.equal(c.audio.currentTime,12);assert.equal(c.engine.positionMs(),12000);c.host.dispose();
});
test('a late native play completion cannot unpause a newer paused selection',async()=>{
  const c=setup({queue:['a','b']});await c.host.switchTo('a',{play:false});let resolve;c.audio.play=()=>new Promise(r=>resolve=()=>{c.audio.paused=false;r();});const old=c.host.play();await c.host.switchTo('b',{play:false});await old;resolve();await flush();assert.equal(c.audio.paused,true);assert.equal(c.host.trackId,'b');c.host.dispose();
});
test('live ownership cancels a pending automatic repair and keeps its original paused intent',async()=>{
  const c=setup();await c.host.switchTo('a');c.audio.tick(18);await fault(c);const token=c.host.suspend();await c.clock.advance(1000);assert.equal(c.reads.length,1);assert.equal(c.audio.paused,true);await c.host.resume(token,{play:false});assert.equal(c.host.desiredPlaying,false);assert.equal(c.audio.currentTime,18);c.host.dispose();
});
test('external media pause requires only one play action to resume',async()=>{
  const c=setup();await c.host.switchTo('a');c.audio.pause();assert.equal(c.host.desiredPlaying,false);c.host.toggle();await flush();assert.equal(c.host.status,'playing');assert.equal(c.audio.paused,false);c.host.dispose();
});
test('the native pause at natural end does not cancel automatic queue advancement',async()=>{
  const c=setup({queue:['a','b']});await c.host.switchTo('a');c.audio.ended=true;c.audio.pause();c.audio.dispatchEvent(new Event('ended'));c.audio.ended=false;await flush();assert.equal(c.host.trackId,'b');assert.equal(c.host.status,'playing');c.host.dispose();
});
test('pause releases a non-settling native play without waiting for its eventual completion',async()=>{
  const c=setup();await c.host.switchTo('a',{play:false});c.audio.play=()=>new Promise(()=>{});const pending=c.host.play();c.host.pause();await pending;assert.equal(c.host.status,'paused');assert.equal(c.clock.tasks.size,0);c.host.dispose();
});
test('play after a fresh-page remote restoration preserves the saved queue position',async()=>{
  const c=setup();c.engine.setPosition(35000);c.host.toggle();await flush();assert.equal(c.audio.currentTime,35);assert.equal(c.host.status,'playing');c.host.dispose();
});
test('expiry before metadata is ready does not erase a pending restored seek',async()=>{
  const c=setup({diagnose:async()=>({failure:{code:'expired',status:410}})});c.audio.hang=true;const first=c.host.switchTo('a',{position:35000});await flush();await fault(c,4);assert.equal(c.engine.positionMs(),35000);assert.equal(c.host.position(),35000);c.audio.hang=false;await c.clock.advance(750);await first;assert.equal(c.audio.currentTime,35);assert.equal(c.host.status,'playing');c.host.dispose();
});
test('a native NotSupportedError rejection cannot outrun a pending expired-resource diagnosis',async()=>{
  let resolve;const c=setup({diagnose:()=>new Promise(r=>resolve=r)}),normal=c.audio.play.bind(c.audio);let first=true;
  c.audio.play=()=>{if(!first)return normal();first=false;c.audio.error={code:4};queueMicrotask(()=>c.audio.dispatchEvent(new Event('error')));return Promise.reject(new DOMException('Source not supported','NotSupportedError'));};
  const pending=c.host.switchTo('a',{position:15000});await flush();assert.equal(c.errors.length,0);assert.equal(c.host.status,'buffering');resolve({failure:{code:'source-expired',status:410}});await flush();await c.clock.advance(750);await pending;
  assert.equal(c.reads.length,2);assert.equal(c.host.status,'playing');assert.equal(c.audio.currentTime,15);assert.equal(c.errors.length,0);c.host.dispose();
});

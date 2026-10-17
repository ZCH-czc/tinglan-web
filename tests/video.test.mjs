import test from 'node:test';
import assert from 'node:assert/strict';
import { VideoPlayback } from '../web/video-playback.mjs';
import { VideoCapabilities,boundedOrigin } from '../web/video-source.mjs';
import { DanmakuSession } from '../web/danmaku-session.mjs';
import { normalizePreferences } from '../web/library-data.mjs';

const stream=(quality=80,codec='avc1.640028',key=quality+'-'+codec)=>({key,quality,codec,label:quality===80?'1080P':'720P',url:'/api/media/'+key,width:1920,height:1080,frameRate:30,bandwidth:2_000_000});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
class Media extends EventTarget {
  src='';paused=true;ended=false;currentTime=0;duration=200;readyState=0;playbackRate=1;muted=false;calls=0;frames={totalVideoFrames:0,droppedVideoFrames:0};
  get currentSrc(){return this.src;}
  canPlayType(type){return type.includes('unsupported')?'':'probably';}
  load(){this.readyState=0;}
  removeAttribute(name){if(name==='src')this.src='';}
  play(){++this.calls;this.paused=false;return this.playResult || Promise.resolve();}
  pause(){this.paused=true;}
  getVideoPlaybackQuality(){return this.frames;}
  fire(event){this.dispatchEvent(new Event(event));}
}
function fixture(sourceFor=async()=>({streams:[stream()]}),options={}) {
  const audio=new Media();audio.src='audible-song';audio.paused=false;audio.currentTime=43;
  const video=new Media(),closes=[];const host={video,open(){},close(_,__,done){closes.push(done);}};
  const states=[];const player=new VideoPlayback({audio,host,sourceFor,changed:value=>states.push(value),...options});
  return {audio,video,player,states,finish:()=>{player.close();for(const done of closes)done();},closes};
}
test('video, quality switches and return preserve the sole audio source, pause state and clock',async()=>{
  const f=fixture(async(_,q)=>({streams:[stream(q)]}));try {
    await f.player.open('first',{quality:80});f.video.readyState=1;f.video.fire('canplay');await Promise.resolve();
    assert.equal(f.audio.src,'audible-song');assert.equal(f.audio.calls,0);assert.equal(f.video.muted,true);assert.equal(f.video.currentTime,43);
    f.audio.currentTime=91;await f.player.open('first',{quality:64});f.video.readyState=1;f.video.fire('canplay');assert.equal(f.video.currentTime,91);assert.equal(f.audio.currentTime,91);
    f.audio.pause();f.audio.fire('pause');assert.equal(f.video.paused,true);f.finish();f.video.fire('canplay');assert.equal(f.player.state.visible,false);assert.equal(f.player.state.status,'idle');assert.equal(f.audio.paused,true);
  }finally{f.finish();}
});
test('200 rapid source requests cannot overwrite the last intent or report obsolete failures',async()=>{
  const requests=[];const f=fixture((id,q,signal)=>{const d=deferred();requests.push({id,q,signal,...d});return d.promise;});
  try {
    const pending=Array.from({length:200},(_,i)=>f.player.open(String(i),{quality:64}));
    assert.ok(requests.slice(0,-1).every(r=>r.signal.aborted));requests.at(-1).resolve({streams:[stream(64,'avc1.4','latest')]});await pending.at(-1);
    for(const r of requests.slice(0,-1))r.reject(new Error('obsolete'));await Promise.all(pending);
    assert.equal(f.player.active.key,'latest');assert.equal(f.player.id,'199');assert.equal(f.player.state.error,'');assert.equal(f.audio.currentTime,43);
  }finally{f.finish();}
});
test('changing video clears the outgoing clock before awaiting a source, while quality changes preserve it',async()=>{
  const requests=[],clocks=[],f=fixture(()=>{const d=deferred();requests.push(d);return d.promise;},{clock:value=>clocks.push(value)});
  try {
    const first=f.player.open('first');assert.equal(clocks.at(-1),43000);requests[0].resolve({streams:[stream()]});await first;
    f.audio.currentTime=190;const next=f.player.open('short-next');assert.equal(clocks.at(-1),0);assert.equal(f.player.state.label,'');
    f.audio.currentTime=0;requests[1].resolve({streams:[stream()]});await next;
    f.audio.currentTime=12;const quality=f.player.open('short-next',{quality:64});assert.equal(clocks.at(-1),12000);requests[2].resolve({streams:[stream(64)]});await quality;
  }finally{f.finish();}
});
test('seeking while paused moves the displayed video frame without starting either channel',async()=>{
  const f=fixture();f.audio.paused=true;
  try{await f.player.open('a');f.video.readyState=1;f.video.fire('loadedmetadata');assert.equal(f.video.currentTime,43);f.audio.currentTime=120;f.audio.fire('seeking');assert.equal(f.video.currentTime,120);assert.equal(f.video.paused,true);assert.equal(f.audio.paused,true);assert.equal(f.video.calls,0);assert.equal(f.audio.calls,0);}finally{f.finish();}
});

test('small audio drift is corrected by bounded rate adjustment instead of repeated decoder seeks',async()=>{
  const f=fixture();try{await f.player.open('a');f.video.readyState=3;f.video.fire('loadedmetadata');f.video.currentTime=42.7;for(let i=0;i<80;i++)f.player.sync();assert.equal(f.video.currentTime,42.7);assert.equal(f.video.playbackRate,1.04);f.audio.currentTime=120;f.audio.fire('seeking');assert.equal(f.video.currentTime,120);f.player.sync();assert.equal(f.video.playbackRate,1);}finally{f.finish();}
});

test('buffering and seeking never count as sustained decoder drops',async()=>{
  let now=0;const f=fixture(async()=>({streams:[stream(),stream(64)]}),{now:()=>now});try{await f.player.open('a');f.video.readyState=2;for(let i=0;i<6;i++){now+=2000;f.video.frames={totalVideoFrames:100*i,droppedVideoFrames:90*i};f.player.sync();}assert.equal(f.player.recoveries,0);f.video.readyState=3;f.video.seeking=true;f.player.sync();now+=2000;f.player.sync();assert.equal(f.player.recoveries,0);}finally{f.finish();}
});

test('a lower quality reported smooth is preferred over a higher quality known to stutter',async()=>{
  const caps=new VideoCapabilities(new Media(),{decodingInfo:async({video})=>({supported:true,smooth:video.width<=1280,powerEfficient:true})});const high={...stream(80),width:1920},low={...stream(64),width:1280};assert.equal((await caps.rank([high,low],80))[0].quality,64);
});
test('closing before a pending reply and reopening during the exit cannot hide the new video',async()=>{
  const d=deferred();let count=0;const f=fixture(()=>++count===1?d.promise:Promise.resolve({streams:[stream(64)]}));
  try {const old=f.player.open('old');f.player.close();await f.player.open('new');f.closes[0]();d.resolve({streams:[stream()]});await old;assert.equal(f.player.state.visible,true);assert.equal(f.player.active.quality,64);assert.equal(f.player.id,'new');}finally{f.finish();}
});
test('decode errors and persistent dropped frames use bounded alternatives without restarting audio',async()=>{
  let now=0;const list=[stream(80,'av01.0.08M.08'),stream(),stream(64,'avc1.4'),stream(32,'avc1.4'),stream(16,'avc1.4')];const f=fixture(async()=>({streams:list}),{now:()=>now});
  try {
    await f.player.open('a');for(let i=0;i<3;i++){f.video.readyState=3;f.video.frames={totalVideoFrames:0,droppedVideoFrames:0};f.player.sync();now+=6000;f.video.frames={totalVideoFrames:100,droppedVideoFrames:40};f.player.sync();}
    f.video.fire('error');assert.equal(f.player.state.status,'error');assert.ok(f.player.recoveries<=3);assert.equal(f.audio.paused,false);assert.equal(f.audio.calls,0);assert.match(f.player.state.error,/audio/i);
  }finally{f.finish();}
});
test('hidden or paused playback cannot resume through a late video play promise',async()=>{
  const d=deferred();let hidden=false;const f=fixture(undefined,{hidden:()=>hidden});f.video.playResult=d.promise;
  try {await f.player.open('a');f.video.readyState=1;f.player.sync(true);hidden=true;f.player.sync();d.resolve();await new Promise(r=>setImmediate(r));assert.equal(f.video.paused,true);assert.equal(f.player.state.background,true);assert.equal(f.player.timer,null);hidden=false;f.audio.pause();f.player.sync();assert.equal(f.video.paused,true);}finally{f.finish();}
});
test('a video play promise resolving after exit cannot leave a hidden decoder running',async()=>{
  const d=deferred(),f=fixture();f.video.playResult=d.promise.then(()=>{f.video.paused=false;});
  await f.player.open('a');f.video.readyState=1;f.player.sync();f.finish();d.resolve();await new Promise(r=>setImmediate(r));assert.equal(f.player.state.visible,false);assert.equal(f.video.paused,true);
});
test('browser capability ranking excludes unsupported codecs and prefers smooth efficient representations',async()=>{
  const video=new Media();let calls=0;const c=new VideoCapabilities(video,{decodingInfo:async({video:v})=>{++calls;return {supported:!v.contentType.includes('av01'),smooth:true,powerEfficient:v.contentType.includes('hvc1')};}});
  const rows=[stream(80,'av01.0.08M.08'),stream(),stream(80,'hvc1.1.6'),stream(64),stream(120),stream(80,'unsupported')];
  assert.deepEqual((await c.rank(rows,80)).map(s=>s.codec),['hvc1.1.6','avc1.640028','avc1.640028','avc1.640028']);await c.rank(rows,80);assert.equal(calls,3);
  const controller=new AbortController();controller.abort();await assert.rejects(c.rank(rows,80,controller.signal),e=>e.name==='AbortError');
});
test('missing, rejected and stalled capability probes retain explicit canPlayType support',async()=>{
  const video=new Media();assert.equal((await new VideoCapabilities(video).rank([stream()],80)).length,1);
  assert.equal((await new VideoCapabilities(video,{decodingInfo:async()=>{throw new Error('unsupported probe');}}).rank([stream()],80)).length,1);
  assert.equal((await new VideoCapabilities(video,{decodingInfo:()=>new Promise(()=>{})}).rank([stream()],80)).length,1);
});
test('video transition origins are finite and remain inside the viewport',()=>{
  assert.equal(boundedOrigin({x:NaN,y:0,width:1,height:1},100,100),null);assert.equal(boundedOrigin({x:0,y:0,width:-1,height:1},100,100),null);
  assert.deepEqual(boundedOrigin({x:500,y:-1,width:999,height:40},100,100),{x:99,y:0,width:1,height:40});
});
test('danmaku follows the last video, coalesces loads and stops accepting replies after close',async()=>{
  const pending=[];let items=[],failures=0;const d=new DanmakuSession((id,signal)=>{const r=deferred();pending.push({id,signal,...r});return r.promise;},value=>items=value,()=>++failures);
  const a=d.select('a',true);await d.select('a',true);const b=d.select('b',true);assert.equal(pending.length,2);assert.equal(pending[0].signal.aborted,true);
  pending[1].resolve({items:[{text:'最新'}]});await b;pending[0].resolve({items:[{text:'旧'}]});await a;assert.equal(items[0].text,'最新');
  await d.select('',false);assert.equal(items.length,0);await d.select('b',true);assert.equal(pending.length,2);assert.equal(items[0].text,'最新');
  const c=d.select('c',true);d.clear();pending.at(-1).reject(new Error('late'));await c;assert.equal(failures,0);assert.equal(items.length,0);
});
test('video and danmaku preferences remain bounded through backup normalization',()=>{
  const p=normalizePreferences({biliQuality:999,danmakuSize:1000,danmakuAlpha:-2,danmakuArea:5,danmakuSpeed:10,danmakuDensity:999,danmakuFps:144,danmakuBlocked:'a'.repeat(2000)});
  assert.equal(p.biliQuality,80);assert.equal(p.danmakuSize,36);assert.equal(p.danmakuAlpha,.1);assert.equal(p.danmakuArea,.85);assert.equal(p.danmakuSpeed,2);assert.equal(p.danmakuDensity,24);assert.equal(p.danmakuFps,30);assert.equal(p.danmakuBlocked.length,1000);
});


test('changing speed preserves audio ownership and paused seek while rejecting invalid rates',async()=>{
  const f=fixture();try {await f.player.open('a');f.audio.pause();f.video.readyState=3;f.player.setRate(1.5);assert.equal(f.audio.playbackRate,1.5);assert.equal(f.video.playbackRate,1.5);assert.equal(f.audio.currentTime,43);assert.equal(f.audio.paused,true);assert.equal(f.video.paused,true);assert.equal(f.audio.preservesPitch,true);
    for(const rate of [0,NaN,Infinity,3,'1.5'])assert.throws(()=>f.player.setRate(rate));
    await f.player.open('a',{quality:64});f.video.readyState=3;f.player.sync(true);assert.equal(f.video.playbackRate,1.5);
  }finally{f.finish();}
});

test('a stalled video source falls back after a deadline without counting time spent paused or hidden',async()=>{
  let now=0,hidden=false;const f=fixture(async()=>({streams:[stream(),stream(64)]}),{now:()=>now,hidden:()=>hidden});
  try {await f.player.open('a');hidden=true;f.player.sync();now=60000;hidden=false;f.player.sync();assert.equal(f.player.recoveries,0);
    now+=20001;f.player.sync();assert.equal(f.player.recoveries,1);assert.equal(f.audio.currentTime,43);assert.equal(f.audio.paused,false);
    f.audio.pause();f.player.sync();now+=60000;f.player.sync();assert.equal(f.player.recoveries,1);
  }finally{f.finish();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserPlayback } from '../web/playback.mjs';

class FakeAudio extends EventTarget {
  constructor() { super(); this.src = ''; this.paused = true; this.currentTime = 0; this.duration = 60; this.readyState = 1; this.playbackRate = 1; this.volume = .8; }
  setAttribute() {}
  removeAttribute() { this.src = ''; }
  load() {}
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  async play() { this.paused = false; this.dispatchEvent(new Event('playing')); }
}
function create(store = { read: async () => new Blob(['audio']) }) {
  const audio = new FakeAudio();
  globalThis.document = { createElement: () => audio, body: { append() {} } };
  let current = 'a', position = 0;
  const errors = [], states = [], tracks = [];
  const engine = {
    selectTrack: id => { if (!['a', 'b'].includes(id)) return false; current = id; return true; }, currentId: () => current,
    currentTrackJson: () => JSON.stringify({ id: current, title: current, artist: '听岚' }),
    setPosition: value => { position = Math.max(0, Math.min(60_000, value)); return position; },
    nextTrack: () => current === 'a' ? 'b' : '', previousTrack: () => 'a',
  };
  const host = new BrowserPlayback(engine, store, { error: error => errors.push(error), state: state => states.push(state), track: id => tracks.push(id), time() {}, duration() {} });
  return { host, audio, engine, errors, states, tracks, position: () => position };
}
test('system media intents notify handoff ownership before delegates or seek handlers change playback',()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator'),handlers=new Map(),events=[];Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaSession:{setActionHandler:(name,handler)=>handlers.set(name,handler)}}});
  try {const c=create();c.host.callbacks.intent=()=>events.push('intent');c.host.mediaDelegate=action=>{events.push(action);return true;};handlers.get('pause')({});assert.deepEqual(events,['intent','pause']);c.host.mediaDelegate=null;events.length=0;handlers.get('seekto')({seekTime:2});assert.deepEqual(events,['intent']);assert.equal(c.position(),2000);c.host.stop();}
  finally{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;}
});
test('only the last asynchronous track load can own the media source', async () => {
  const pending = new Map(); const context = create({ read: (_, id) => new Promise(resolve => pending.set(id, resolve)) });
  const first = context.host.switchTo('a'); const second = context.host.switchTo('b');
  pending.get('b')(new Blob(['b'])); await second;
  const url = context.audio.src;
  pending.get('a')(new Blob(['a'])); assert.equal(await first, false);
  assert.equal(context.host.trackId, 'b'); assert.equal(context.audio.src, url); assert.equal(context.host.status, 'playing');
  context.host.stop();
});
test('pause while a file is loading prevents automatic play on resolution', async () => {
  let resolve; const context = create({ read: () => new Promise(done => resolve = done) });
  const pending = context.host.switchTo('a'); context.host.pause(); resolve(new Blob(['a'])); await pending;
  assert.equal(context.audio.paused, true); assert.equal(context.host.desiredPlaying, false); context.host.stop();
});
test('pause while play promise is unresolved remains paused', async () => {
  const context = create(); await context.host.switchTo('a', { play: false });
  let resolve; context.audio.play = () => new Promise(done => resolve = done);
  const pending = context.host.play(); context.host.pause(); resolve(); await pending;
  assert.equal(context.audio.paused, true); assert.equal(context.host.desiredPlaying, false); context.host.stop();
});
test('an obsolete failed load never reports an error for a newer song', async () => {
  let reject; const context = create({ read: (_, id) => id === 'a' ? new Promise((_, fail) => reject = fail) : Promise.resolve(new Blob(['b'])) });
  const first = context.host.switchTo('a'); await context.host.switchTo('b'); reject(new Error('old failure')); await first;
  assert.equal(context.errors.length, 0); assert.equal(context.host.status, 'playing'); context.host.stop();
});
test('restoration loads media paused and seeks only after metadata is ready', async () => {
  const context = create(); context.audio.readyState = 0;
  await context.host.switchTo('a', { play: false, position: 9000 });
  assert.equal(context.audio.paused, true); assert.equal(context.host.pendingSeek, 9000);
  context.audio.readyState = 1; context.audio.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(context.audio.currentTime, 9); assert.equal(context.host.pendingSeek, 0); context.host.stop();
});
test('autoplay rejection becomes an actionable paused state', async () => {
  const context = create(); context.audio.play = () => Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
  await context.host.switchTo('a'); assert.equal(context.host.status, 'paused');
  assert.match(context.errors[0], /Tap Play/i); context.host.stop();
});
test('missing bytes produce an error instead of leaving a permanent spinner', async () => {
  const context = create({ read: async () => undefined });
  assert.equal(await context.host.switchTo('a'), false); assert.equal(context.host.status, 'error');
  assert.match(context.errors[0], /Import it again/i); context.host.stop();
});
test('stopping invalidates in-flight reads and releases the source', async () => {
  let resolve; const context = create({ read: () => new Promise(done => resolve = done) });
  const pending = context.host.switchTo('a'); context.host.stop(); resolve(new Blob(['a'])); await pending;
  assert.equal(context.audio.src, ''); assert.equal(context.host.url, null); assert.equal(context.host.status, 'idle');
});
test('volume and seek are bounded before touching the host', async () => {
  const context = create(); await context.host.switchTo('a', { play: false });
  context.host.setVolume(100); assert.equal(context.audio.volume, 1);
  context.host.setVolume(-1); assert.equal(context.audio.volume, 0);
  context.host.seek(100000); assert.equal(context.audio.currentTime, 60); context.host.stop();
});
test('music suspension preserves position and original play intent across live ownership',async()=>{
  const c=create();await c.host.switchTo('a');c.audio.currentTime=23;const token=c.host.suspend();assert.equal(c.audio.paused,true);await c.host.play();assert.equal(c.audio.paused,true);await c.host.resume(token);assert.equal(c.audio.currentTime,23);assert.equal(c.audio.paused,false);c.host.stop();
});
test('a new music choice invalidates an old live suspension instead of restoring the old track',async()=>{
  const c=create();await c.host.switchTo('a');const token=c.host.suspend();await c.host.switchTo('b');assert.equal(await c.host.resume(token),false);assert.equal(c.host.trackId,'b');c.host.stop();
});
test('live entry aborts music loading and a stale load cannot steal the source',async()=>{
  let resolve;const c=create({sourceFor:()=>new Promise(r=>resolve=r)});const pending=c.host.switchTo('a');c.host.suspend();assert.equal(c.host.sourceAbort.signal.aborted,true);resolve(new Blob(['old']));await pending;assert.equal(c.audio.src,'');assert.equal(c.audio.paused,true);c.host.stop();
});
test('an unresolved old music play that completes during live is forced to remain paused',async()=>{
  const c=create();await c.host.switchTo('a',{play:false});let resolve;c.audio.play=()=>new Promise(done=>resolve=()=>{c.audio.paused=false;done();});const pending=c.host.play();c.host.suspend();resolve();await pending;assert.equal(c.audio.paused,true);c.host.stop();
});
test('rapid online switches abort obsolete stream requests and retain only the latest source',async()=>{
  const tasks=new Map();const context=create({sourceFor:(id,signal)=>new Promise((resolve,reject)=>{tasks.set(id,{resolve,signal});signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});})});
  const first=context.host.switchTo('a');const second=context.host.switchTo('b');assert.equal(tasks.get('a').signal.aborted,true);
  tasks.get('b').resolve({url:'/api/media/approved',type:'audio/mpeg'});await second;assert.equal(await first,false);
  assert.equal(context.audio.src,'http://localhost/api/media/approved');assert.equal(context.errors.length,0);context.host.stop();assert.equal(tasks.get('b').signal.aborted,true);
});

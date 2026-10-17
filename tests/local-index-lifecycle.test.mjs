import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalIndexDecoder} from '../web/local-index-decoder.mjs';
import {LocalIndexManager} from '../web/local-index-manager.mjs';
import {LocalIndexMatcher,LocalIndexWorker} from '../web/local-index-client.mjs';
import {MusicRecognition} from '../web/music-recognition.mjs';
import {WorkerClient} from '../web/worker-client.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const marks=()=>new Uint8Array([1,0,0,0,0,0,0,0]).buffer;
const pcm=()=>({samples:new Float32Array(96000).fill(.2),rate:16000});
const localSong={id:'local-test',source:'local',title:'测试歌曲',artist:'听岚'};
const audio=()=>({duration:120,length:120*16000,numberOfChannels:2,sampleRate:16000,copyFromChannel(out,channel,start){out.fill((channel+1)/10);out[0]=start/10000000;}});

test('native offline decode remains exclusively owned after cancellation until the native promise settles',async()=>{
  const gate=deferred();let contexts=0;const decoder=new LocalIndexDecoder({OfflineContext:class{constructor(){contexts++;}decodeAudioData(){return gate.promise;}}}),first=new AbortController();
  const pending=decoder.offline(new Blob(['audio']),first.signal);await flush();first.abort();await assert.rejects(pending,{name:'AbortError'});assert(decoder.pending);
  await assert.rejects(decoder.offline(new Blob(['audio']),new AbortController().signal),/still releasing/i);assert.equal(contexts,1);gate.resolve(audio());await flush();assert.equal(decoder.pending,null);
  await decoder.offline(new Blob(['audio']),new AbortController().signal);assert.equal(contexts,2);
});
test('native decode observation timeout retains its one pending owner instead of starting parallel fallback',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const gate=deferred(),decoder=new LocalIndexDecoder({OfflineContext:class{decodeAudioData(){return gate.promise;}}});
  const pending=decoder.offline(new Blob(['audio']),new AbortController().signal);const rejected=assert.rejects(pending,/timed out|timeout/i);await flush();t.mock.timers.tick(45001);await rejected;assert(decoder.pending);gate.resolve(audio());await flush();assert.equal(decoder.pending,null);t.mock.timers.reset();
});
test('fast decode copies only three bounded windows and transfers their channel buffers to the worker',async()=>{
  let contexts=0;const calls=[],worker={run:async(op,input,options)=>{calls.push({op,input,options});return op==='inspect'?{seconds:120,channels:2}:marks();}};
  const decoder=new LocalIndexDecoder({OfflineContext:class{constructor(){contexts++;}decodeAudioData(){return Promise.resolve(audio());}},capture:{record:()=>assert.fail('fast path must not run real-time capture')}});
  assert.equal((await decoder.analyze(new Blob(['audio']),worker,{signal:new AbortController().signal})).byteLength,24);assert.equal(contexts,1);
  const segments=calls.filter(c=>c.op==='extract');assert.deepEqual(segments.map(c=>c.input.frameOffset),[0,1250,2500]);for(const c of segments){assert.equal(c.input.channels.length,2);assert.equal(c.input.channels[0].length,640000);assert.deepEqual(c.options.transfer,c.input.channels.map(c=>c.buffer));}
});
test('memory-limited fallback samples head/middle/tail silently and releases capture ownership after every segment',async()=>{
  const samples=[],decoder=new LocalIndexDecoder({OfflineContext:undefined,duration:async()=>120,beforeCapture:()=>samples.push('pause'),capture:{record:async input=>{assert.equal(decoder.captureActive,true);assert.equal(input.analysis,true);samples.push([input.startSeconds,input.seconds]);return {samples:new Float32Array(640000),rate:16000};}}});
  // Explicit null also avoids a browser's global fallback in browser-hosted test runners.
  decoder.OfflineContext=null;await decoder.analyze(new Blob(['audio']),{run:async op=>op==='inspect'?{seconds:120,channels:2}:marks()},{signal:new AbortController().signal});
  assert.deepEqual(samples,['pause',[0,40],'pause',[40,40],'pause',[80,40]]);assert.equal(decoder.captureActive,false);
});
test('manager cancels stale builds without an old finally closing the newer build worker',async()=>{
  const gates=[deferred(),deferred()];let started=0,closed=0,saved=0;const source={blob:new Blob(['audio']),track:localSong,revision:'r',epoch:'e'};
  const index={epoch:async()=> 'e',eligible:async()=>[localSong],prune:async()=>{},source:async()=>source,store:{read:async()=>null},save:async()=>{saved++;return true;},info:async()=>({count:saved,bytes:saved*8})};
  const manager=new LocalIndexManager(index,{worker:{close(){closed++;}},decoder:{pending:null,analyze(){return gates[started++].promise;}}});
  try{const a=manager.build();await flush();assert.equal(started,1);manager.cancel();const b=manager.build();await flush();assert.equal(started,2);const before=closed;gates[0].resolve(marks());assert.equal(await a,false);assert.equal(closed,before);assert.equal(manager.state.building,true);gates[1].resolve(marks());assert.equal(await b,true);assert.equal(saved,1);assert.equal(manager.state.done,1);assert.equal(manager.state.progress,0);}finally{manager.dispose();}
});
test('manager skips valid reusable entries, rejects changed epochs and never builds while native cleanup is pending',async()=>{
  const b=marks(),digest=Buffer.from(await crypto.subtle.digest('SHA-256',b)).toString('hex');let saves=0,analyses=0;
  const index={epoch:async()=> 'e',eligible:async()=>[localSong],prune:async()=>{},source:async()=>({epoch:'e',revision:'r',blob:new Blob(['audio'])}),store:{read:async()=>({version:1,revision:'r',epoch:'e',pairs:new Blob([b]),bytes:8,digest})},save:async()=>{saves++;return true;},info:async()=>({count:1,bytes:8})};
  const decoder={pending:null,analyze:async()=>{analyses++;return b;}},manager=new LocalIndexManager(index,{decoder,worker:{close(){}}});try{assert.equal(await manager.build(),true);assert.equal(saves,0);assert.equal(analyses,0);decoder.pending=Promise.resolve();assert.equal(await manager.build(),false);assert.equal(manager.view().waitingDecoder,true);decoder.pending=null;index.source=async()=>({epoch:'new',revision:'r'});assert.equal(await manager.build(),false);assert.match(manager.state.error,/cleared in another page/i);}finally{manager.dispose();}
});
test('only active fallback sampling is interrupted by a playback intent',()=>{
  const decoder={captureActive:false,pending:null},manager=new LocalIndexManager({}, {decoder,worker:{close(){}}});try{manager.state.building=true;manager.playbackIntent();assert.equal(manager.state.building,true);decoder.captureActive=true;manager.playbackIntent();assert.equal(manager.state.building,false);assert.match(manager.state.notice,/Playback resumed/i);}finally{manager.dispose();}
});
test('offline recognition never generates an online fingerprint or calls cloud matching, including local errors',async()=>{
  for(const match of [async()=>({matched:false}),async()=>{throw new Error('local error');},async()=>({matched:true,origin:'local',song:localSong})]){
    const history=[],r=new MusicRecognition({mode:'offline',capture:{record:async()=>pcm()},fingerprint:{run:()=>assert.fail('online fingerprint')},match:()=>assert.fail('cloud request'),localMatch:match,history:{save:async s=>history.push(s),list:async()=>history}});await r.start();assert(['no-match','error','result'].includes(r.state.phase));if(history.length)assert.equal(history[0].recognizedVia,'local');
  }
});
test('auto mode preserves PCM for cloud fallback; a successful local match avoids the online path',async()=>{
  let cloud=0;const original=pcm();const r=new MusicRecognition({capture:{record:async()=>original},fingerprint:{run:async input=>{assert.equal(input.samples.length,96000);return 'signature';}},match:async()=>{cloud++;return {matched:false};},localMatch:async(input,{preserve})=>{assert.equal(preserve,true);assert.equal(input,original);return {matched:false};}});
  await r.start();assert.equal(cloud,1);r.localMatch=async()=>({matched:true,origin:'local',song:localSong});r.history={save:async()=>{},list:async()=>[]};await r.start();assert.equal(cloud,1);assert.equal(r.state.result.id,localSong.id);
});
test('late local match and final storage resolution cannot overwrite a newer recognition request',async()=>{
  const a=deferred(),b=deferred();let called=0,closes=0;const matcher=new LocalIndexMatcher({info:async()=>({count:1}),resolve:async id=>({id,source:'local',title:id})},{worker:{close(){closes++;},run:()=>++called===1?a.promise:b.promise}});
  const first=matcher.match(pcm()),firstRejected=assert.rejects(first,{name:'AbortError'});await flush();const second=matcher.match(pcm());await flush();const before=closes;a.resolve({matched:false});await firstRejected;assert.equal(closes,before);b.resolve({matched:true,id:'local-new',revision:'r',epoch:'e'});assert.equal((await second).song.id,'local-new');assert.equal(closes,before+1);
});
test('matching copies transferable PCM in auto mode and revalidates file identity on the UI side',async()=>{
  const original=pcm();let moved;const matcher=new LocalIndexMatcher({info:async()=>({count:1}),resolve:async()=>null},{worker:{close(){},run:async(op,input,{transfer})=>{moved=structuredClone(input,{transfer});return {matched:true,id:localSong.id,revision:'old',epoch:'e'};}}});
  const result=await matcher.match(original,{preserve:true});assert.equal(original.samples.length,96000);assert.equal(moved.samples.length,96000);assert.equal(result.matched,false);
});
test('old worker cancellation cannot terminate a newer run after worker replacement',async()=>{
  const gates=[deferred(),deferred()];let calls=0,closes=0;const worker=new LocalIndexWorker({client:{run:()=>gates[calls++].promise,close(){closes++;}}}),old=new AbortController();
  const first=worker.run('inspect',null,{signal:old.signal}),rejected=assert.rejects(first,{name:'AbortError'});const second=worker.run('inspect',null,{});old.abort();assert.equal(closes,0);gates[0].resolve({});await rejected;gates[1].resolve({ok:true});assert.deepEqual(await second,{ok:true});
});
test('worker-client transfers buffers rather than cloning retained PCM and terminates on completion cleanup',async t=>{
  const original=globalThis.Worker;let instance;globalThis.Worker=class{constructor(){instance=this;this.listeners={};}addEventListener(type,fn){this.listeners[type]=fn;}postMessage(message,transfer){this.message=structuredClone(message,{transfer});}terminate(){this.terminated=true;}};t.after(()=>{globalThis.Worker=original;});
  const client=new WorkerClient('worker.mjs'),samples=new Float32Array(96000),pending=client.run('match',{samples},()=>{},{transfer:[samples.buffer]});assert.equal(samples.byteLength,0);assert.equal(instance.message.input.samples.length,96000);instance.listeners.message({data:{id:1,result:{matched:false}}});assert.deepEqual(await pending,{matched:false});client.close();assert.equal(instance.terminated,true);
});

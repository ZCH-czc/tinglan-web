import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {LibraryStore} from '../web/storage.mjs';
import {createBackup,readBackup} from '../web/backup.mjs';
import {RecognitionHistory,recognitionHistory,recognitionSong,recognitionPage,mergeRecognitionHistory} from '../web/recognition-data.mjs';
import {fingerprintPcm} from '../web/recognition-pcm.mjs';
import {MusicRecognition} from '../web/music-recognition.mjs';
import {BrowserRecognitionCapture,BrowserFingerprint,validRecognitionFile} from '../web/recognition-capture.mjs';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const song=(id='1')=>({id:'netease-'+id,remoteId:id,source:'netease',title:'海风 '+id,artist:'听岚',album:'山与海',durationMs:180000,artworkUrl:'https://p1.music.126.net/cover.jpg'});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
async function store(){globalThis.indexedDB=new IDBFactory();const result=new LibraryStore();await result.open();return result;}
function host(options={}){const events=[],saved=[];const h=new MusicRecognition({capture:{record:async({onReady,onProgress})=>{onReady();onProgress(.5);return {samples:new Float32Array(96000),rate:16000};}},fingerprint:{run:async()=> 'AQIDBA=='},history:{list:async()=>saved,save:async row=>saved.push({...row,recognizedAt:1000}),clear:async()=>{saved.length=0;}},match:async()=>({matched:true,song:song()}),changed:()=>events.push(h.state.phase),...options});return {h,events,saved};}

test('recognition metadata removes PCM, fingerprints and device details and restricts artwork',()=>{
  const out=recognitionSong({...song(),fingerprint:'SECRET',pcm:new Float32Array(2),deviceId:'microphone',artworkUrl:'https://other.test/a.jpg'});assert.equal(out.artworkUrl,'');assert.equal(out.hasArtwork,false);for(const key of ['fingerprint','pcm','deviceId'])assert.equal(key in out,false);assert.throws(()=>recognitionSong({...song(),id:'qq-1'}));
});
test('history filtering normalizes width and clamps pages',()=>{const rows=Array.from({length:20},(_,i)=>({...song(String(i+1)),title:'ＡＢＣ '+i,recognizedAt:1000+i}));assert.equal(recognitionPage(rows,'abc',99).page,1);assert.equal(recognitionPage(rows,'abc',0).items.length,12);assert.equal(recognitionPage(rows,'missing').count,0);});
test('durable history handles concurrent records, latest duplicate and 100 row bound',async()=>{
  const s=await store(),history=new RecognitionHistory(s);try{await Promise.all(Array.from({length:110},(_,i)=>history.save(song(String(i+1)),{now:1000+i})));let rows=await history.list();assert.equal(rows.length,100);assert.equal(rows[0].id,'netease-110');await history.save(song('20'),{now:3000});rows=await history.list();assert.equal(rows[0].id,'netease-20');assert.equal(rows.filter(row=>row.id==='netease-20').length,1);await history.clear();assert.deepEqual(await history.list(),[]);}finally{s.db.close();}
});
test('cancelled history save commits no record',async()=>{const s=await store();try{const controller=new AbortController();controller.abort();await assert.rejects(new RecognitionHistory(s).save(song(),{signal:controller.signal}),{name:'AbortError'});assert.equal((await new RecognitionHistory(s).list()).length,0);}finally{s.db.close();}});
test('history is included in backup and newer local recognition survives restore',async()=>{
  const s=await store();try{const h=new RecognitionHistory(s);await h.save(song(),{now:1000});const snapshot=await s.snapshot();snapshot.preferences={};const packed=await createBackup(snapshot),restored=await readBackup(packed.blob);assert.equal(restored.recognitionHistory[0].recognizedAt,1000);await h.save(song(),{now:2000});await s.mergeBackup(restored,{});assert.equal((await h.list())[0].recognizedAt,2000);assert(!JSON.stringify(restored).includes('rawdata'));}finally{s.db.close();}
});
test('malformed history and overflow reject before restore',()=>{assert.throws(()=>recognitionHistory(Array(101).fill({...song(),recognizedAt:1})));assert.throws(()=>recognitionHistory([{...song(),recognizedAt:-1}]));assert.deepEqual(mergeRecognitionHistory(undefined,undefined),[]);});
test('PCM resampling preserves passband and rejects quiet, NaN and incomplete captures',()=>{
  const rate=48000,tone=f=>Float32Array.from({length:rate*6},(_,i)=>.4*Math.sin(2*Math.PI*f*i/rate));const rms=a=>Math.sqrt(a.reduce((s,n)=>s+n*n,0)/a.length);const low=fingerprintPcm(tone(440),rate),high=fingerprintPcm(tone(9000),rate);assert.equal(low.length,48000);assert(rms(low)>.27 && rms(low)<.29);assert(rms(high)<.005);assert.throws(()=>fingerprintPcm(new Float32Array(96000),16000),/too quiet/i);assert.throws(()=>fingerprintPcm(new Float32Array(1),16000));const bad=tone(440);bad[0]=NaN;assert.throws(()=>fingerprintPcm(bad,rate));
});
test('successful recognition records one result and exposes every processing phase',async()=>{const {h,events,saved}=host();assert.equal(await h.start(),true);assert.equal(saved.length,1);assert.equal(h.view().result.id,'netease-1');assert.deepEqual([...new Set(events)],['permission','listening','fingerprinting','matching','result']);assert.equal(h.busy,false);});
test('cancel during microphone acquisition cannot fingerprint or save a late input',async()=>{const gate=deferred();let calls=0;const {h,saved}=host({capture:{record:()=>gate.promise},fingerprint:{run:async()=>{++calls;return 'AQIDBA==';}}});const pending=h.start();h.cancel();gate.resolve({samples:new Float32Array(1),rate:16000});await pending;assert.equal(calls,0);assert.equal(saved.length,0);assert.equal(h.state.phase,'idle');});
test('late match cannot replace a newer recognition or enter history',async()=>{const first=deferred();let attempts=0;const {h,saved}=host({match:()=>++attempts===1?first.promise:Promise.resolve({matched:true,song:song('2')})});const old=h.start();await flush();h.cancel();await h.start();first.resolve({matched:true,song:song('1')});await old;assert.equal(h.state.result.id,'netease-2');assert.deepEqual(saved.map(s=>s.id),['netease-2']);});
test('no match is a complete result and does not save a history record',async()=>{const {h,saved}=host({match:async()=>({matched:false,song:null})});assert.equal(await h.start(),true);assert.equal(h.state.phase,'no-match');assert.equal(saved.length,0);});
test('permission or processing failure and service errors never automatically retry',async()=>{let calls=0;const {h}=host({match:async()=>{++calls;throw new Error('服务冷却');}});await h.start();assert.equal(calls,1);assert.equal(h.state.error,'服务冷却');const denied=host({capture:{record:async()=>{throw new Error('权限被拒绝');}},match:async()=>{throw new Error('should not happen');}});await denied.h.start();assert.equal(denied.h.state.error,'权限被拒绝');});
test('failed durable history does not discard a recognized song',async()=>{const {h}=host({history:{save:async()=>{throw new Error('quota');},list:async()=>[]}});await h.start();assert.equal(h.state.phase,'result');assert.equal(h.state.result.id,'netease-1');assert.match(h.state.notice,/history could not be saved/i);});
test('a second click during active capture does not create another input',async()=>{const gate=deferred();let calls=0;const {h}=host({capture:{record:()=>{calls++;return gate.promise;}}});const p=h.start();assert.equal(await h.start(),false);assert.equal(calls,1);h.cancel();gate.resolve({samples:new Float32Array(1),rate:16000});await p;});

class Context {state='running';closed=0;destination={};audioWorklet={addModule:async()=>{}};resume(){return Promise.resolve();}close(){this.closed++;this.state='closed';return Promise.resolve();}createMediaStreamSource(){return {connect(){},disconnect(){}};}}
test('a permission grant arriving after cancellation is immediately stopped',async()=>{
  const grant=deferred(),controller=new AbortController();let stops=0,context;class C extends Context{constructor(){super();context=this;}}
  const c=new BrowserRecognitionCapture({Context:C,Node:class{},devices:{getUserMedia:()=>grant.promise}}),pending=c.record({signal:controller.signal});await flush();controller.abort();await assert.rejects(pending,{name:'AbortError'});grant.resolve({getTracks:()=>[{stop(){stops++;}}]});await flush();assert.equal(stops,1);assert.equal(context.closed,1);
});
test('failed audio context preparation also stops a later microphone permission grant',async()=>{
  const grant=deferred();let stopped=0;class C extends Context{resume(){return Promise.reject(new Error('resume denied'));}}
  const c=new BrowserRecognitionCapture({Context:C,Node:class{},devices:{getUserMedia:()=>grant.promise}});await assert.rejects(c.record({signal:new AbortController().signal}),/resume denied/);grant.resolve({getTracks:()=>[{stop(){stopped++;}}]});await flush();assert.equal(stopped,1);
});
test('unsupported and oversized files cannot open a microphone',async()=>{let opened=0;const c=new BrowserRecognitionCapture({Context,Node:class{},devices:{getUserMedia:()=>{opened++;}}});const file=new Blob(['x'],{type:'application/json'});assert.equal(validRecognitionFile(file),false);await assert.rejects(c.record({file,signal:new AbortController().signal}),/64 MB/);assert.equal(opened,0);});
test('file autoplay denial gives file guidance and releases its context, source and URL',async()=>{
  let context,revoked=0,stopped=0;class C extends Context{constructor(){super();context=this;}createMediaElementSource(){return {connect(){},disconnect(){stopped++;}};}}
  class Node{port={close(){},postMessage(){}};connect(){}disconnect(){}}
  class Audio extends EventTarget{readyState=1;duration=10;setAttribute(){}removeAttribute(){}load(){}pause(){}play(){return Promise.reject(new DOMException('Autoplay denied','NotAllowedError'));}}
  const c=new BrowserRecognitionCapture({Context:C,Node,createAudio:()=>new Audio(),urls:{createObjectURL:()=> 'blob:fixture',revokeObjectURL:()=>revoked++}});
  await assert.rejects(c.record({file:new Blob(['audio'],{type:'audio/wav'}),signal:new AbortController().signal}),/browser blocked audio access/i);assert.equal(context.closed,1);assert.equal(stopped,1);assert.equal(revoked,1);
});
test('finite capture processor emits one mono buffer and sparse progress while keeping output silent',async()=>{
  let Processor;const messages=[];class Base{port={postMessage:(data,transfers)=>messages.push({data,transfers})};}
  runInNewContext(await readFile(new URL('../web/recognition-worklet.mjs',import.meta.url),'utf8'),{AudioWorkletProcessor:Base,sampleRate:16000,Float32Array,registerProcessor:(name,C)=>{assert.equal(name,'tinglan-recognition-capture');Processor=C;}});
  const p=new Processor(),a=new Float32Array(128).fill(.6),b=new Float32Array(128).fill(.2),out=new Float32Array(128).fill(1);p.process([[a,b]],[[out]]);assert.equal(messages.length,0);p.port.onmessage({data:'start'});for(let i=0;i<800;i++)p.process([[a,b]],[[out]]);const complete=messages.filter(row=>row.data.samples);assert.equal(complete.length,1);assert.equal(complete[0].data.samples.length,96000);assert(Math.abs(complete[0].data.samples[10]-.4)<1e-6);assert.equal(complete[0].transfers.length,1);assert(messages.length<30);assert(out.every(n=>n===0));
});
test('cancelling fingerprint work terminates the dedicated worker',async()=>{let worker;class W{constructor(){worker=this;}postMessage(){}terminate(){this.closed=(this.closed || 0)+1;}}const controller=new AbortController(),p=new BrowserFingerprint({WorkerClass:W}).run({samples:new Float32Array(1),rate:16000},{signal:controller.signal});controller.abort();await assert.rejects(p,{name:'AbortError'});assert.equal(worker.closed,1);});

test('analysis seeks to the requested window before starting finite capture and releases every owned resource',async()=>{
  const events=[];let context,options;class C extends Context{constructor(){super();context=this;}createMediaElementSource(){return {connect(){events.push('connect');},disconnect(){events.push('disconnect');}};}}
  class Node{constructor(_,name,o){options=o;this.port={close:()=>events.push('port-close'),postMessage:()=>queueMicrotask(()=>this.port.onmessage({data:{samples:new Float32Array(640000),rate:16000}}))};}connect(){}disconnect(){}}
  class Audio extends EventTarget{readyState=1;duration=120;set currentTime(n){events.push(['seek',n]);queueMicrotask(()=>this.dispatchEvent(new Event('seeked')));}setAttribute(){}removeAttribute(){events.push('src-remove');}load(){}pause(){}play(){events.push('play');return Promise.resolve();}}
  const capture=new BrowserRecognitionCapture({Context:C,Node,createAudio:()=>new Audio(),urls:{createObjectURL:()=> 'blob:window',revokeObjectURL:()=>events.push('revoke')}});
  const result=await capture.record({file:new Blob(['audio']),analysis:true,seconds:40,startSeconds:40,signal:new AbortController().signal});assert.equal(result.samples.length,640000);assert.equal(options.processorOptions.seconds,40);assert(events.findIndex(e=>Array.isArray(e) && e[0]==='seek')<events.indexOf('play'));assert.equal(context.closed,1);for(const name of ['disconnect','src-remove','port-close','revoke'])assert(events.includes(name));
});
test('40-second analysis processor mixes eight channels, emits once and bounds progress to four updates per second',async()=>{
  let Processor;const messages=[];class Base{port={postMessage:(data,transfers)=>messages.push({data,transfers})};}
  runInNewContext(await readFile(new URL('../web/recognition-worklet.mjs',import.meta.url),'utf8'),{AudioWorkletProcessor:Base,sampleRate:16000,Float32Array,registerProcessor:(_,C)=>Processor=C});
  const p=new Processor({processorOptions:{seconds:40}}),input=Array.from({length:8},(_,i)=>new Float32Array(128).fill(i/10)),out=new Float32Array(128).fill(1);p.port.onmessage({data:'start'});for(let i=0;i<5100;i++)p.process([input],[[out]]);const complete=messages.filter(m=>m.data.samples);assert.equal(complete.length,1);assert.equal(complete[0].data.samples.length,640000);assert(Math.abs(complete[0].data.samples[2]-.35)<1e-6);assert(messages.length<=161);assert(out.every(n=>n===0));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {soundSettings,soundPatch,SOUND_DEFAULTS} from '../web/audio-settings.mjs';
import {ComfortDsp} from '../web/audio-dsp.mjs';
import {AudioOutput} from '../web/audio-output.mjs';
import {BrowserSound} from '../web/audio-engine.mjs';
import {normalizePreferences} from '../web/library-data.mjs';
import {createBackup,readBackup} from '../web/backup.mjs';
import {SnapshotBridge} from '../web/snapshot-bridge.mjs';

const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const rms=a=>Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length);
function tone(amplitude,length=48000,frequency=1000){return Float32Array.from({length},(_,i)=>Math.sin(i*2*Math.PI*frequency/48000)*amplitude);}
function render(settings,left,right=left){const dsp=new ComfortDsp(48000,{enabled:true,...settings}),l=new Float32Array(left.length),r=new Float32Array(left.length);dsp.process(left,right,l,r);return {dsp,l,r};}
class Element extends EventTarget {src='fixture';paused=true;currentTime=12;calls=[];sinkId='';async setSinkId(id){this.calls.push(id);this.sinkId=id;}}
class Devices extends EventTarget {rows=[{kind:'audiooutput',deviceId:'default',label:'Default'},{kind:'audiooutput',deviceId:'headphones',label:'Headphones'},{kind:'audiooutput',deviceId:'speaker',label:'Speaker'}];async enumerateDevices(){return this.rows;}getUserMedia(){throw new Error('Must not request microphone');}}
class Param {value=0;calls=[];cancelScheduledValues(t){this.calls.push(['cancel',t]);}setTargetAtTime(v,t,k){this.value=v;this.calls.push(['target',v,t,k]);}}
class Node {links=new Set();gain=new Param();frequency=new Param();Q=new Param();connect(n){this.links.add(n);return n;}disconnect(){this.links.clear();}}
class Worklet extends Node {constructor(context,name,options){super();this.options=options;this.messages=[];this.port={postMessage:value=>this.messages.push(value),close:()=>{this.closed=true;}};context.worklets.push(this);}}
function setup({module,Context,resume,settings=SOUND_DEFAULTS,devices=new Devices()}={}){
 const contexts=[],timers=new Map(),elements=[new Element(),new Element(),new Element()];let serial=0;
 class AudioContext {
  state='suspended';currentTime=1;sampleRate=48000;destination=new Node();worklets=[];created=new Map();sinkId='';sinkCalls=[];
  constructor(){contexts.push(this);this.audioWorklet={addModule:async()=>{if(module)await module.promise;}};}
  async resume(){if(resume)await resume.promise;this.state='running';}async suspend(){this.state='suspended';}async close(){this.state='closed';}
  async setSinkId(id){this.sinkCalls.push(id);this.sinkId=id;}
  createGain(){return new Node();}createBiquadFilter(){return new Node();}
  createMediaElementSource(e){assert.equal(this.created.has(e),false);const n=new Node();this.created.set(e,n);return n;}
 }
 const sound=new BrowserSound(elements,settings,{Context:Context===null?null:AudioContext,Worklet,devices,setTimer:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},clearTimer:id=>timers.delete(id)});
 return {sound,elements,devices,contexts,timers,async idle(){for(const [id,t] of [...timers])if(t.ms===300){timers.delete(id);t.fn();}await flush();}};
}

test('sound settings clamp portable values, reject unknown keys and accept self-drawn numeric band events',()=>{
 assert.deepEqual(soundSettings(),soundSettings(SOUND_DEFAULTS));const value=soundSettings({enabled:'true',bands:[999,-999,NaN,Infinity,2,9],outputGainDb:999,spatialPreset:'bad',deviceId:'private'});
 assert.equal(value.enabled,false);assert.deepEqual(value.bands,[12,-12,0,0,2]);assert.equal(value.outputGainDb,0);assert.equal(value.deviceId,undefined);
 const custom=soundPatch(value,{key:'band',index:'2',value:'7'});assert.equal(custom.bands[2],7);assert.equal(custom.eqPreset,'custom');assert.equal(value.bands[2],0);
 assert.deepEqual(soundPatch(custom,{key:'unknown',value:4}),custom);assert.deepEqual(soundPatch(custom,{key:'eqPreset',value:'flat'}).bands,[0,0,0,0,0]);
});
test('silence and invalid PCM produce finite zeros without background amplification',()=>{
 const input=new Float32Array([0,NaN,Infinity,-Infinity,0]),{l,r}=render({},input);assert.deepEqual([...l],[0,0,0,0,0]);assert.ok([...r].every(Number.isFinite));
 assert.throws(()=>new ComfortDsp(0,{}));assert.throws(()=>new ComfortDsp(Infinity,{}));
});
test('quiet stereo remains unchanged and retains channel ratios',()=>{
 const left=tone(.02),right=left.map(x=>x*.25),{l,r}=render({},left,right);assert.deepEqual(l,left);assert.deepEqual(r,right);assert.ok(rms(l)<=rms(left));
});
test('loud material is attenuated from its first nonzero block after silence',()=>{
 const dsp=new ComfortDsp(48000,{enabled:true,loudness:true,peakProtection:true}),silent=new Float32Array(128);dsp.process(silent,silent,new Float32Array(128),new Float32Array(128));
 const input=tone(.9,128),l=new Float32Array(128),r=new Float32Array(128);dsp.process(input,input,l,r);assert.ok(rms(l)<.16);assert.ok(rms(l)<rms(input)*.3);
});
test('balanced, comfort and night targets progressively reduce sustained loudness',()=>{
 const input=tone(.8),levels=['balanced','comfort','night'].map(loudnessPreset=>rms(render({loudnessPreset},input).l));assert.ok(levels[0]<.14);assert.ok(levels[1]<levels[0]);assert.ok(levels[2]<levels[1]);
});
test('instant linked peak protection catches transients and preserves stereo balance',()=>{
 const input=new Float32Array([.01,4,-4,.01]),right=input.map(x=>x*.5),{l,r}=render({loudness:false},input,right);assert.ok(Math.max(...l.map(Math.abs))<=10**(-2/20)+1e-7);for(let i=0;i<l.length;i++)assert.ok(Math.abs(r[i]-l[i]*.5)<1e-6);
});
test('disabling all effects is sample-exact; output gain only attenuates',()=>{
 const input=tone(.3);assert.deepEqual(render({enabled:false},input).l,input);const {l}=render({loudness:false,peakProtection:false,outputGainDb:-6},input);assert.ok(Math.abs(rms(l)/rms(input)-10**(-6/20))<1e-5);
});
test('all spatial profiles retain finite bounded stereo and reset reused buffers',()=>{
 for(const spatialPreset of ['natural','wide','car','headphones']){const input=tone(.5,48000,500),{dsp,l,r}=render({spatial:true,spatialPreset},input,input.map(x=>-x));assert.ok(l.every(Number.isFinite));assert.ok(r.every(Number.isFinite));assert.ok(Math.max(...l.map(Math.abs))<.8);const buffer=dsp.delayL;dsp.reset();assert.equal(dsp.delayL,buffer);assert.ok(buffer.every(x=>x===0));}
});
test('sound preferences survive portable backup but physical device IDs and labels do not',async()=>{
 const preferences=normalizePreferences({audioEffects:{enabled:true,eqEnabled:true,bands:[1,2,3,4,5],spatial:true},deviceId:'private-speaker',audioDevices:[{id:'private',label:'Private device'}]});
 const {blob}=await createBackup({tracks:[],media:[],artwork:[],playlists:[],preferences}),restored=await readBackup(blob);assert.deepEqual(restored.preferences.audioEffects,preferences.audioEffects);assert.equal(restored.preferences.deviceId,undefined);assert.equal(restored.preferences.audioDevices,undefined);
});
test('default original playback creates no AudioContext or worklet',async()=>{
 const c=setup();await c.sound.prepare(c.elements[0]);assert.equal(c.contexts.length,0);assert.equal(c.sound.view().status,'off');c.sound.dispose();
});
test('1000 simultaneous setting updates share one context, worklet and three fixed source nodes',async()=>{
 const c=setup(),settings={enabled:true,eqEnabled:true,bands:[1,2,3,4,5]};await Promise.all(Array.from({length:1000},()=>c.sound.configure(settings)));assert.equal(c.contexts.length,1);assert.equal(c.contexts[0].worklets.length,1);assert.equal(c.contexts[0].created.size,3);assert.equal(c.sound.view().status,'active');assert.equal(c.sound.headroom.gain.value,10**(-5/20));c.sound.dispose();
});
test('off/on changes preserve media time and use a single audible graph connection',async()=>{
 const c=setup();await c.sound.configure({enabled:true});const mix=c.sound.mix;assert.equal(mix.links.size,1);await c.sound.configure({enabled:false});assert.deepEqual([...mix.links],[c.sound.master]);await c.sound.configure({enabled:true});assert.deepEqual([...mix.links],[c.sound.headroom]);assert.equal(c.contexts[0].created.size,3);assert.ok(c.elements.every(e=>e.currentTime===12 && e.paused));c.sound.dispose();
});
test('switching off during module preparation never captures the original media',async()=>{
 const module=deferred(),c=setup({module});const pending=c.sound.configure({enabled:true});await c.sound.configure({enabled:false});module.resolve();await pending;assert.equal(c.contexts[0].created.size,0);assert.equal(c.sound.view().status,'off');c.sound.dispose();
});
test('module failure keeps original audio and exposes explicit bypass feedback',async()=>{
 const module=deferred(),c=setup({module});const pending=c.sound.configure({enabled:true});module.reject(new Error('fixture module failed'));assert.equal(await pending,false);assert.equal(c.sound.view().status,'bypass');assert.equal(c.contexts[0].created.size,0);await c.sound.prepare(c.elements[0]);assert.equal(c.elements[0].src,'fixture');c.sound.dispose();
});
test('processor failure uses original bypass; explicit retry replaces only the worklet',async()=>{
 const c=setup();await c.sound.configure({enabled:true});const old=c.sound.processor;old.onprocessorerror();assert.equal(c.sound.view().status,'bypass');assert.deepEqual([...c.sound.mix.links],[c.sound.master]);await c.sound.configure({enabled:true});assert.notEqual(c.sound.processor,old);assert.equal(c.contexts[0].created.size,3);assert.equal(c.sound.view().status,'active');assert.equal(old.closed,true);c.sound.dispose();
});
test('idle context suspends without a rendering timer and resumes for the same source',async()=>{
 const c=setup();await c.sound.configure({enabled:true});await c.idle();assert.equal(c.contexts[0].state,'suspended');await c.sound.prepare(c.elements[0]);assert.equal(c.contexts[0].state,'running');assert.equal(c.timers.size,0);const n=c.sound.processor.messages.length;await c.sound.prepare(c.elements[0]);assert.equal(c.sound.processor.messages.length,n);c.sound.dispose();
});

test('user volume follows the DSP so leveling cannot counteract volume changes',async()=>{
 const c=setup();c.sound.setVolume(.25);assert.ok(c.elements.every(e=>e.volume===.25));await c.sound.configure({enabled:true});assert.ok(c.elements.every(e=>e.volume===1));assert.equal(c.sound.master.gain.value,.25);c.sound.setVolume(.05);assert.equal(c.sound.master.gain.value,.05);assert.ok(c.elements.every(e=>e.volume===1));assert.deepEqual([...c.sound.master.links],[c.contexts[0].destination]);c.sound.dispose();
});
test('failed route rollback remains recoverable by explicitly reselecting default',async()=>{
 const element=new Element(),output=new AudioOutput([element],{devices:new Devices()});await output.refresh();let fail=true;element.setSinkId=async id=>{if(fail)throw new DOMException('fixture','NotFoundError');element.sinkId=id;};assert.equal(await output.select('headphones'),false);assert.equal(output.uncertain,true);fail=false;assert.equal(await output.select(''),true);assert.equal(output.uncertain,false);assert.equal(element.sinkId,'');output.dispose();
});
test('unsupported audio processing leaves original media available',async()=>{
 const c=setup({Context:null});assert.equal(c.sound.view().supported,false);assert.equal(await c.sound.configure({enabled:true}),false);await c.sound.prepare(c.elements[0]);assert.equal(c.elements[0].src,'fixture');c.sound.dispose();
});
test('dispose during delayed preparation leaves no captured media or device observer',async()=>{
 const module=deferred(),c=setup({module});const pending=c.sound.configure({enabled:true});c.sound.dispose();module.resolve();await pending;assert.equal(c.contexts[0].created.size,0);assert.equal(c.contexts[0].state,'closed');assert.equal(c.timers.size,0);
});
test('device enumeration is bounded, excludes input devices and never opens a microphone',async()=>{
 const devices=new Devices();devices.rows=[...Array.from({length:100},(_,i)=>({kind:'audiooutput',deviceId:'d'+i,label:'device\n'+i})),{kind:'audioinput',deviceId:'mic',label:'Microphone'}];const output=new AudioOutput([new Element()],{devices});await output.refresh();assert.equal(output.rows.length,32);assert.ok(output.rows.every(r=>!r.label.includes('\n')));assert.equal(await output.select('mic'),false);output.dispose();
});
test('100 rapid device choices coalesce behind the pending native operation and end at latest selection',async()=>{
 const element=new Element(),hold=deferred(),output=new AudioOutput([element],{devices:new Devices()});await output.refresh();let count=0;element.setSinkId=async id=>{element.calls.push(id);if(++count===1)await hold.promise;element.sinkId=id;};const pending=output.select('headphones');for(let i=0;i<100;i++)output.select(i%2?'speaker':'headphones');hold.resolve();await pending;assert.equal(output.selected,'speaker');assert.deepEqual(element.calls,['headphones','speaker']);output.dispose();
});
test('partial output failure restores previous route and does not claim success',async()=>{
 const elements=[new Element(),new Element()],output=new AudioOutput(elements,{devices:new Devices()});await output.refresh();elements[1].setSinkId=async id=>{if(id==='headphones')throw new DOMException('fixture','NotAllowedError');elements[1].sinkId=id;};assert.equal(await output.select('headphones'),false);assert.equal(output.selected,'');assert.ok(elements.every(e=>e.sinkId===''));assert.match(output.warning,/denied|not allowed/i);output.dispose();
});
test('context attachment joins in-flight output changes without applying a stale device last',async()=>{
 const element=new Element(),hold=deferred(),output=new AudioOutput([element],{devices:new Devices()});await output.refresh();element.setSinkId=async id=>{if(id==='headphones')await hold.promise;element.sinkId=id;};const pending=output.select('headphones'),context=new Element(),attaching=output.attach(context);output.select('speaker');hold.resolve();await Promise.all([pending,attaching]);assert.equal(output.selected,'speaker');assert.equal(element.sinkId,'speaker');assert.equal(context.sinkId,'speaker');output.dispose();
});
test('missing context sink support prevents custom-device graph capture',async()=>{
 const output=new AudioOutput([new Element()],{devices:new Devices()});await output.refresh();await output.select('headphones');await assert.rejects(output.attach({}),/system default/i);assert.equal(output.selected,'headphones');output.dispose();
});
test('device removal reconciles to system default without starting playback',async()=>{
 const devices=new Devices(),element=new Element(),output=new AudioOutput([element],{devices});await output.refresh();await output.select('headphones');devices.rows=[];await output.refresh(true);assert.equal(output.selected,'');assert.match(output.warning,/disconnected/i);assert.equal(element.paused,true);output.dispose();
});
test('one explicit device chooser request is shared and cancellation preserves current route',async()=>{
 const devices=new Devices(),hold=deferred();let requests=0;devices.selectAudioOutput=()=>{requests++;return hold.promise;};const output=new AudioOutput([new Element()],{devices});const a=output.request(),b=output.request();assert.equal(a,b);assert.equal(requests,1);assert.equal(output.view().busy,true);hold.reject(new DOMException('cancel','NotAllowedError'));assert.equal(await a,false);assert.equal(output.selected,'');assert.equal(output.view().busy,false);output.dispose();
});
test('sound/device state crosses the Wasm boundary once for 1000 unchanged scalar updates',async()=>{
 const c=setup(),sent=[],bridge=new SnapshotBridge(raw=>sent.push(JSON.parse(raw)));await c.sound.output.refresh();for(let i=0;i<1000;i++)bridge.publish({viewKey:'home',position:i,audioInfo:c.sound.view(),audioDevices:c.sound.output.rows});assert.equal(sent.filter(s=>'audioInfo' in s).length,1);assert.equal(sent.filter(s=>'audioDevices' in s).length,1);assert.equal(bridge.pages.get('home').has('audioDevices'),false);c.sound.dispose();
});


test('saved enabled settings stay lazy until playback and report the actual waiting state',async()=>{const c=setup({settings:{enabled:true}});assert.equal(c.sound.view().status,'waiting');assert.equal(c.contexts.length,0);await c.sound.prepare(c.elements[0]);assert.equal(c.sound.view().status,'active');assert.equal(c.contexts.length,1);c.sound.dispose();});
test('failed default fallback after device removal never reports a successful switch',async()=>{const devices=new Devices(),element=new Element(),output=new AudioOutput([element],{devices});await output.refresh();await output.select('headphones');element.setSinkId=async()=>{throw new DOMException('fixture','NotFoundError');};devices.rows=[];await output.refresh(true);assert.equal(output.selected,'headphones');assert.match(output.warning,/unavailable/i);assert.ok(!output.warning.includes('已切回'));output.dispose();});


test('unavailable realtime output cannot capture or mute directly playing original media',async()=>{const resume=deferred(),c=setup({resume});c.elements[0].paused=false;const pending=c.sound.configure({enabled:true});await flush();const task=[...c.timers].find(([,t])=>t.ms===1500);assert.ok(task);c.timers.delete(task[0]);task[1].fn();assert.equal(await pending,false);assert.equal(c.contexts[0].created.size,0);assert.equal(c.sound.view().status,'bypass');await c.sound.prepare(c.elements[0]);assert.equal(c.elements[0].paused,false);resume.resolve();await flush();await c.idle();assert.equal(c.contexts[0].state,'suspended');c.sound.dispose();});

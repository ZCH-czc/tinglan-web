import {tr} from './i18n.mjs';
import {soundSettings,EQ_FREQUENCIES} from './audio-settings.mjs';
import {AudioOutput} from './audio-output.mjs';
import {playbackTask} from './playback-task.mjs';
import {hostSetTimeout,hostClearTimeout} from './host-api.mjs';

/** One lazy audio context serves the existing mutually exclusive music/radio/live decoders. */
export class BrowserSound {
 constructor(elements,settings,{Context=globalThis.AudioContext,Worklet=globalThis.AudioWorkletNode,devices=globalThis.navigator?.mediaDevices,changed=()=>{},setTimer=hostSetTimeout,clearTimer=hostClearTimeout,moduleUrl=new URL('./audio-worklet.mjs',import.meta.url)}={}){
  Object.assign(this,{elements,Context,Worklet,changed,setTimer,clearTimer,moduleUrl});const notify=this.changed;this.changed=()=>{this.snapshot=null;notify();};this.settings=soundSettings(settings);this.supported=!!(Context && Worklet);this.status=this.settings.enabled && this.supported?'waiting':'off';this.warning='';this.sources=new Map();this.volume=Number.isFinite(elements[0]?.volume)?elements[0].volume:1;this.version=0;
  this.output=new AudioOutput(elements,{devices,changed:this.changed,setTimer,clearTimer});
  this.events=[];for(const element of elements){const play=()=>{this.clearIdle();this.boundary(element);if(this.captured)this.context.resume().catch(()=>{});},idle=()=>this.scheduleIdle();for(const [event,listener] of [['play',play],['pause',idle],['ended',idle],['emptied',idle],['error',idle]]){element.addEventListener(event,listener);this.events.push([element,event,listener]);}}
 }
 view(){return this.snapshot ||= {supported:this.supported,status:this.status,warning:this.warning,settings:this.settings,output:this.output.view()};}
 setVolume(value){this.volume=Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;for(const element of this.elements)element.volume=this.sources.has(element)?1:this.volume;if(this.master)this.param(this.master.gain,this.volume);}
 boundary(element){if(this.owner!==element || this.ownerSource!==element.src){this.owner=element;this.ownerSource=element.src;this.processor?.port.postMessage({type:'reset'});}}
 clearIdle(){if(this.idleTimer!=null)this.clearTimer(this.idleTimer);this.idleTimer=null;}
 scheduleIdle(){this.clearIdle();const idle=()=>!this.captured && !this.initializing || this.elements.every(e=>e.paused);if(!this.disposed && this.context && idle())this.idleTimer=this.setTimer(()=>{this.idleTimer=null;if(!this.disposed && idle())this.context.suspend().catch(()=>{});},300);}
 gesture(){if(this.disposed)return;if(this.settings.enabled && !this.failed)this.ensure().catch(()=>{});if(this.captured)this.context.resume().catch(()=>{});}
 createProcessor(){
  this.processor?.disconnect();this.processor?.port.close();this.filters.at(-1).disconnect();
  this.processor=new this.Worklet(this.context,'tinglan-comfort',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit',processorOptions:{settings:this.settings}});
  this.processor.onprocessorerror=()=>{this.failed=true;this.processorFailed=true;this.warning=tr("Effects paused; using original audio. Re-enable effects to retry");this.status='bypass';this.bypass();this.changed();};
  this.filters.at(-1).connect(this.processor);this.processorFailed=false;this.routed=false;
 }
 async ensure(){if(this.captureError)throw this.captureError;if(this.captured){if(this.processorFailed)this.createProcessor();return;}if(this.initializing)return this.initializing;if(!this.supported)throw new Error(tr("This browser does not support audio-worklet tuning"));
  this.context ||= new this.Context({latencyHint:'balanced'});this.status='starting';this.changed();
  // Synchronous creation/resume preserves the caller's user activation. Nodes capture only after all setup succeeds.
  const resumed=this.context.resume();
  this.initializing=(async()=>{
   try{await playbackTask(()=>resumed,{timeoutMs:1500,timers:{setTimeout:this.setTimer,clearTimeout:this.clearTimer}});}catch{throw new Error(tr("Audio processing unavailable; using original audio. Re-enable effects to retry"));}
   if(this.context.state!=='running')throw new Error(tr("Audio processing unavailable; using original audio. Re-enable effects to retry"));
   if(!this.context.audioWorklet)throw new Error(tr("This browser does not support audio-worklet tuning"));
   await playbackTask(()=>this.context.audioWorklet.addModule(this.moduleUrl),{timeoutMs:8000});
   await playbackTask(()=>this.output.attach(this.context),{timeoutMs:5000});if(this.disposed || !this.settings.enabled)return;
   if(this.context.state!=='running')throw new Error(tr("Audio processing paused; using original audio. Re-enable effects to retry"));
   const context=this.context;this.master=context.createGain();this.master.gain.value=this.volume;this.master.connect(context.destination);this.mix=context.createGain();this.headroom=context.createGain();this.filters=EQ_FREQUENCIES.map(frequency=>{const f=context.createBiquadFilter();f.type='peaking';f.frequency.value=Math.min(frequency,context.sampleRate*.45);f.Q.value=1;return f;});
   this.mix.connect(this.headroom);let last=this.headroom;for(const f of this.filters){last.connect(f);last=f;}this.createProcessor();this.processor.connect(this.master);this.routed=true;
   try{for(const element of this.elements){const source=context.createMediaElementSource(element);this.sources.set(element,source);source.connect(this.mix);}this.captured=true;this.output.contextOnly=true;this.setVolume(this.volume);}
   catch(error){this.captured=this.sources.size>0;this.captureError=new Error(tr("Some audio channels could not enable effects. Using original audio; reload to retry"));this.setVolume(this.volume);this.bypass();throw this.captureError;}
   this.apply();
  })().catch(error=>{if(!this.disposed){this.failed=true;this.warning=error.message || tr("Effects could not start. Using original audio");this.status='bypass';this.bypass();this.changed();}throw error;}).finally(()=>{this.initializing=null;this.scheduleIdle();});return this.initializing;
 }
 bypass(){if(!this.mix)return;try{this.mix.disconnect();this.processor?.disconnect();this.mix.connect(this.master);this.routed=false;}catch{}}
 param(parameter,value){const at=this.context.currentTime;parameter.cancelScheduledValues(at);parameter.setTargetAtTime(value,at,.015);}
 apply(){if(!this.captured || this.disposed)return;const enabled=this.settings.enabled && !this.failed;
  if(this.routed!==enabled){this.mix.disconnect();this.processor.disconnect();if(enabled){this.mix.connect(this.headroom);this.processor.connect(this.master);}else this.mix.connect(this.master);this.routed=enabled;}
  const gains=this.settings.eqEnabled?this.settings.bands:[0,0,0,0,0];for(let i=0;i<5;i++)this.param(this.filters[i].gain,gains[i]);
  this.param(this.headroom.gain,10**(-Math.max(0,...gains)/20));this.processor.port.postMessage({type:'settings',value:this.settings});this.status=enabled?'active':'off';this.changed();this.scheduleIdle();
 }
 async configure(value){this.settings=soundSettings(value);this.failed=false;this.warning='';const version=++this.version;this.changed();
  if(!this.settings.enabled){this.status='off';this.apply();this.scheduleIdle();return true;}
  if(this.captured || this.initializing)this.context?.resume().catch(()=>{});
  try{await this.ensure();if(version!==this.version || this.disposed)return false;this.apply();this.gesture();this.scheduleIdle();return true;}catch(error){if(version===this.version && !this.disposed){this.failed=true;this.warning ||= error.message || tr("Effects could not start. Using original audio");this.status='bypass';this.bypass();this.changed();}return false;}
 }
 async prepare(element){if(this.disposed)return;if(this.settings.enabled && !this.failed)try{await this.ensure();}catch{/* Uncaptured media remains directly audible. */}
  if(this.captured){this.clearIdle();try{await playbackTask(()=>this.context.resume(),{timeoutMs:3000});if(this.context.state!=='running')throw new Error();}catch{throw Object.assign(new Error(tr("Tap Play to resume the browser audio channel")),{name:'NotAllowedError'});}this.boundary(element);}
 }
 dispose(){this.disposed=true;this.clearIdle();this.output.dispose();for(const [element,event,listener] of this.events)element.removeEventListener(event,listener);for(const source of this.sources.values())source.disconnect();this.sources.clear();this.processor?.port.close();this.context?.close().catch(()=>{});}
}

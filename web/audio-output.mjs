import {hostSetTimeout,hostClearTimeout} from './host-api.mjs';

const message=error=>({NotAllowedError:'The browser denied access to this output device',NotFoundError:'This playback device disconnected',AbortError:'Playback device switch incomplete',InvalidStateError:'Tap the selection button and try again'}[error?.name] || 'Unable to switch output device right now');
/** Device identities and labels are session-only. No microphone or persistent account access. */
export class AudioOutput {
 constructor(elements,{devices=globalThis.navigator?.mediaDevices,changed=()=>{},setTimer=hostSetTimeout,clearTimer=hostClearTimeout}={}){
  Object.assign(this,{elements,devices,changed,setTimer,clearTimer});this.extra=null;this.selected='';this.wanted='';this.rows=[];this.warning='';this.busy=false;this.disposed=false;this.readVersion=0;this.topology=0;this.appliedTopology=0;
  this.onDevices=()=>this.refresh(true);devices?.addEventListener?.('devicechange',this.onDevices);
 }
 targets(){return this.contextOnly?[this.extra]:[...this.elements,...(this.extra?[this.extra]:[])];}
 set(target,id){try{return Promise.resolve(target.setSinkId(id));}catch(error){return Promise.reject(error);}}
 view(){return {available:this.targets().every(e=>typeof e.setSinkId==='function'),canRequest:typeof this.devices?.selectAudioOutput==='function',selected:this.selected,busy:this.busy || !!this.requesting,warning:this.warning};}
 async refresh(reconcile=false){const version=++this.readVersion;try{
  const all=await this.devices?.enumerateDevices?.() || [];if(version!==this.readVersion || this.disposed)return;
  const seen=new Set(['','default']);this.rows=[];
  for(const d of all)if(d.kind==='audiooutput' && typeof d.deviceId==='string' && d.deviceId.length<=512 && d.deviceId && !seen.has(d.deviceId) && this.rows.length<32){seen.add(d.deviceId);this.rows.push({id:d.deviceId,label:String(d.label || `Playback device ${this.rows.length+1}`).replace(/[\r\n\x00-\x1f]/g,' ').slice(0,160)});}
  this.changed();if(reconcile && this.selected && !seen.has(this.selected)){const restored=await this.select('');this.warning=restored?(this.selected===''?'The previous device disconnected. Using the system default':'The previous device disconnected. Using the new output selection'):'The previous device disconnected and default output is unavailable. Choose a device again';this.changed();}
 }catch{if(version===this.readVersion && !this.disposed){this.warning='Unable to read devices. System default output remains available';this.changed();}}}
 request(){if(this.requesting)return this.requesting;if(!this.devices?.selectAudioOutput){this.warning='This browser has no device picker. Choose an authorized device below or use system sound settings';this.changed();return Promise.resolve(false);}
  // Call in the original click stack, before any await, to retain transient activation.
  let operation;try{operation=this.devices.selectAudioOutput();}catch(error){operation=Promise.reject(error);}
  this.requesting=Promise.resolve(operation).then(async device=>{if(this.disposed)return false;if(device?.kind!=='audiooutput' || typeof device.deviceId!=='string' || device.deviceId.length>512)throw new Error();await this.refresh();if(!this.rows.some(row=>row.id===device.deviceId) && device.deviceId && device.deviceId!=='default')this.rows=[...this.rows.slice(0,31),{id:device.deviceId,label:String(device.label || 'Authorized playback device').slice(0,160)}];return this.select(device.deviceId==='default'?'':device.deviceId);}).catch(error=>{if(!this.disposed){this.warning=message(error);this.changed();}return false;}).finally(()=>{this.requesting=null;if(!this.disposed)this.changed();});this.changed();return this.requesting;
 }
 select(id){if(typeof id!=='string' || id && !this.rows.some(row=>row.id===id))return Promise.resolve(false);this.wanted=id;this.warning='';if(this.pending)return this.pending;
  this.busy=true;this.changed();this.slowTimer=this.setTimer(()=>{if(this.pending && !this.disposed){this.warning='The system is still switching output. Wait before choosing again';this.changed();}},10000);this.slowTimer?.unref?.();this.pending=this.drain().finally(()=>{this.clearTimer(this.slowTimer);this.pending=null;this.busy=false;if(!this.disposed)this.changed();});return this.pending;
 }
 async drain(){let success=true;
  while(!this.disposed && (this.wanted!==this.selected || this.topology!==this.appliedTopology || this.uncertain)){const id=this.wanted,previous=this.selected,topology=this.topology,all=this.targets(),targets=all.filter(t=>typeof t.setSinkId==='function');
   if(id && targets.length!==all.length){this.warning='This browser cannot switch output devices within the app';this.wanted=this.selected;return false;}
   const results=await Promise.allSettled(targets.map(t=>this.set(t,id)));if(this.disposed)return false;
   const failure=results.find(r=>r.status==='rejected');
   if(failure){const rollback=await Promise.allSettled(targets.map(t=>this.set(t,previous)));this.uncertain=rollback.some(r=>r.status==='rejected');this.warning=message(failure.reason)+(this.uncertain?'，Some channels have unconfirmed status. Select system default again':'');this.appliedTopology=topology;success=false;if(this.wanted===id){this.wanted=previous;this.changed();return false;}}
   else {this.selected=id;this.appliedTopology=topology;this.uncertain=false;}this.changed();
  }return success;
 }
 async attach(context){if(this.disposed)return false;
  // A context is exposed before capture, so an overlapping route change includes it.
  if(this.wanted && typeof context.setSinkId!=='function')throw new Error('This browser cannot use this output together with effects. Choose system default first');
  this.extra=context;++this.topology;if(!await this.select(this.wanted))throw new Error('Effects could not connect to this device. Choose system default first');
  return !this.disposed;
 }
 dispose(){this.disposed=true;++this.readVersion;this.clearTimer(this.slowTimer);this.devices?.removeEventListener?.('devicechange',this.onDevices);this.rows=[];}
}

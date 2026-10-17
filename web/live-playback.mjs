import {hostSetTimeout,hostClearTimeout} from './host-api.mjs';
import {liveRoomFromLink} from './live-room.mjs';
import {liveDescription} from './live-description.mjs';
export {liveRoomFromLink};
/** A live room owns one decoder and a revocable music suspension; no requests poll room metadata. */
export class LivePlayback {
  constructor({video,music,loadRoom,loadSource,attach,revoke=()=>{},supported=()=>true,changed=()=>{},hidden=()=>false,setTimer=hostSetTimeout,clearTimer=hostClearTimeout}) {
    Object.assign(this,{video,music,loadRoom,loadSource,attach,revoke,supported,changed,hidden});this.revision=0;this.attachment=0;this.candidates=[];this.candidateIndex=-1;this.active=false;this.desired=false;this.state={status:'idle',roomId:'',room:null,qualities:[],error:'',quality:0,label:'',fullscreen:false};
    Object.assign(this,{setTimer,clearTimer});
    for(const [event,status] of [['playing','playing'],['waiting','buffering'],['pause','paused']])video.addEventListener(event,()=>{
      if(!this.active || this.detaching || !this.adapter)return;if(status==='playing' && (!this.desired || this.hidden())){video.pause();return;}this.patch({status,...(status==='playing'?{notice:''}:{})});
    });
    video.addEventListener('error',()=>{
      if(!this.active || !this.adapter || !video.error || this.detaching)return;
      if([3,4].includes(video.error.code))this.decoderFailure('Unable to decode this stream. Choose another quality or reload');
      else this.networkFailure('Live connection lost');
    });
    video.addEventListener('ended',()=>{if(this.active && this.adapter){this.desired=false;this.adapter.stop?.();this.patch({status:'ended',error:'The stream ended. Return to music or reload'});}});
  }
  patch(value){const old=this.state.status;this.state={...this.state,...value};
    if(old!==this.state.status || value.status==='loading' || value.status==='buffering' && value.quality!==undefined){this.clearTimer(this.watchdog);this.watchdog=null;if(['loading','buffering'].includes(this.state.status)){this.watchdog=this.setTimer(()=>this.networkFailure('Live buffering timed out'),this.state.status==='loading'?45000:25000);this.watchdog?.unref?.();}}
    this.state.desired=this.desired;this.changed(this.state);
  }
  releaseDecoder(){++this.attachment;this.detaching=true;this.adapter?.destroy();this.adapter=null;this.video.pause();this.video.removeAttribute('src');this.video.load();this.detaching=false;}
  release(){this.releaseDecoder();this.candidates=[];this.candidateIndex=-1;for(const url of this.urls || [])Promise.resolve(this.revoke(url)).catch(()=>{});this.urls=[];}
  async startCandidate(index,revision=this.revision) {
    if(!this.active || revision!==this.revision)return false;
    this.releaseDecoder();const ticket=this.attachment,stream=this.candidates[index];this.candidateIndex=index;
    this.patch({quality:stream.quality,label:stream.label,status:'buffering',error:'',notice:index>0?'Switching to a compatible format…':''});
    try {
      const adapter=await this.attach(this.video,stream.url,(error,details)=>{
        if(revision!==this.revision || ticket!==this.attachment)return;
        if(details?.recoverable)this.decoderFailure(error,{soft:details.performance===true});else if(details?.transient)this.networkFailure(error);else this.fail(error);
      },this.abort.signal);
      if(revision!==this.revision || ticket!==this.attachment || !this.active){adapter.destroy();return false;}
      this.adapter=adapter;this.video.volume=this.music.audio.volume;
      if(this.hidden() || !this.desired){adapter.stop?.();this.patch({status:'paused',background:this.hidden()});}else await this.play();
      return revision===this.revision && ticket===this.attachment;
    }catch(error){if(revision===this.revision && ticket===this.attachment && error.name!=='AbortError')this.fail(error.message || 'Unable to load stream. Retry manually');return false;}
  }
  decoderFailure(message,{soft=false}={}) {
    if(!this.active || this.detaching)return;
    const next=this.candidateIndex+1;
    if(this.desired && !this.hidden() && next<this.candidates.length && next<3){void this.startCandidate(next);return;}
    if(soft){this.patch({notice:message});return;}
    this.fail(message);
  }

  networkFailure(message) {
    if(!this.active)return;
    if(!this.desired || (this.retries || 0)>=2){this.fail(message+'，Retry manually');return;}
    this.clearTimer(this.reconnectTimer);this.abort?.abort();++this.revision;this.releaseDecoder();
    this.reconnectNeeded=true;const revision=this.revision,attempt=this.retries=(this.retries || 0)+1;
    this.patch({status:'reconnecting',error:'',notice:`${message}，Reconnecting（${attempt}/2）…`});
    if(!this.hidden()){this.reconnectTimer=this.setTimer(()=>{if(revision===this.revision && this.desired && !this.hidden())this.open(this.state.roomId,this.state.quality || 80,{recovery:true});},attempt===1?1000:3000);this.reconnectTimer?.unref?.();}
  }
  async open(id,quality=80,{play=true,recovery=false}={}) {
    if(!liveRoomFromLink(id)){this.fail('Invalid live room ID');return false;}
    this.clearTimer(this.reconnectTimer);this.reconnectNeeded=false;if(!recovery)this.retries=0;
    const revision=++this.revision;this.abort?.abort();this.abort=new AbortController();
    if(!this.active){this.active=true;this.suspension=this.music.suspend();}this.desired=play;this.release();
    this.patch({roomId:id,room:recovery?this.state.room:null,qualities:recovery?this.state.qualities:[],quality:quality,label:'',status:'loading',error:'',notice:recovery?'Reconnecting to stream…':'',background:this.hidden()});
    try {
      const loaded=await this.loadRoom(id,this.abort.signal);if(revision!==this.revision)return false;
      const room={...loaded,description:liveDescription(loaded.description),area:String(loaded.area || '').split(' · ').filter(Boolean).join(' · ')};this.patch({room});
      if(!room.live){this.desired=false;this.patch({status:'ended',error:'UP creator is offline'});return false;}
      const source=await this.loadSource(room.roomId,quality,this.abort.signal);
      if(revision!==this.revision){for(const s of source.streams || [])Promise.resolve(this.revoke(s.url)).catch(()=>{});return false;}
      this.urls=(source.streams || []).map(s=>s.url);
      if(!source.live){this.desired=false;this.patch({status:'ended',error:'Stream ended'});return false;}
      const streams=(source.streams || []).filter(s=>this.supported(s)).sort((a,b)=>Math.abs(a.quality-quality)-Math.abs(b.quality-quality) || Number(a.codec!=='avc')-Number(b.codec!=='avc') || Number(a.format!=='fmp4')-Number(b.format!=='fmp4'));
      this.patch({qualities:source.qualities || []});
      if(!streams.length)throw new Error('This browser does not support the stream’s codec');
      this.candidates=streams;
      return await this.startCandidate(0,revision);
    } catch(error){if(revision===this.revision && error.name!=='AbortError')this.fail(error.message || 'Unable to load stream. Retry manually');return false;}
  }
  fail(error){if(!this.active)return;this.clearTimer(this.reconnectTimer);this.reconnectNeeded=false;++this.attachment;this.desired=false;this.adapter?.stop?.();this.video.pause();this.patch({status:'error',error});}
  async play() {
    if(!this.active)return;this.desired=true;if(this.hidden())return;if(!this.adapter){if(['paused','error','reconnecting'].includes(this.state.status))return this.open(this.state.roomId,this.state.quality || 80);return;}const revision=this.revision,ticket=this.attachment;this.adapter.start?.();this.patch({error:'',status:'buffering'});
    try {if(this.beforePlay)await this.beforePlay(this.video);if(revision!==this.revision || ticket!==this.attachment || !this.desired || this.hidden())return;await this.video.play();if(!this.active || !this.desired || this.hidden())this.video.pause();}
    catch(error){if(revision===this.revision && ticket===this.attachment && this.desired && error.name!=='AbortError'){this.desired=false;this.patch({status:'paused',error:error.name==='NotAllowedError'?'Tap Play to allow the browser to start the stream':'Stream unavailable. Retry manually'});}}
  }
  pause(){this.clearTimer(this.reconnectTimer);this.reconnectNeeded=false;this.desired=false;this.adapter?.stop?.();this.video.pause();this.patch({status:'paused'});}
  toggle(){if(this.desired)this.pause();else if(!this.adapter || this.state.status==='error' || this.state.status==='ended')this.open(this.state.roomId,this.state.quality || 80);else this.play();}
  visibility() {if(!this.active)return;if(this.hidden()){this.clearTimer(this.reconnectTimer);this.adapter?.stop?.();this.video.pause();this.patch({background:true,status:'paused'});}else {this.patch({background:false});if(this.desired){if(this.reconnectNeeded)this.open(this.state.roomId,this.state.quality || 80,{recovery:true});else this.play();}}}
  async close({resume=true}={}) {
    if(!this.active)return;this.clearTimer(this.reconnectTimer);this.reconnectNeeded=false;this.active=false;this.desired=false;++this.revision;this.abort?.abort();this.release();const token=this.suspension;this.suspension=null;
    this.patch({status:'idle',roomId:'',room:null,qualities:[],error:'',fullscreen:false});await this.music.resume(token,{play:resume});
  }
}

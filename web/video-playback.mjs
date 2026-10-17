import { VideoCapabilities } from './video-source.mjs';
export const VIDEO_RATES=Object.freeze([.5,.75,1,1.25,1.5,2]);

/** The existing audio element remains the sole audible clock through video/quality switches. */
export class VideoPlayback {
  constructor({audio,host,sourceFor,changed,clock=()=>{},capabilities,hidden=()=>false,now=()=>performance.now()}) {
    Object.assign(this,{audio,host,sourceFor,changed,clock,hidden,now});this.video=host.video;this.capabilities=new VideoCapabilities(this.video,capabilities);
    this.state={visible:false,status:'idle',quality:0,label:'',qualities:[],codec:'',error:'',background:false,width:16,height:9};this.revision=0;this.mediaRevision=0;this.id='';this.timer=null;this.failures=new Set();this.recoveries=0;this.playingPromise=null;
    for(const event of ['play','pause','seeking','seeked','ratechange','playing','waiting','timeupdate'])audio.addEventListener(event,()=>this.sync(['seeking','seeked'].includes(event)));
    this.video.addEventListener('loadedmetadata',()=>{if(this.isCurrent())this.sync(true);});
    this.video.addEventListener('canplay',()=>{if(this.isCurrent()){this.patch({status:'ready',error:''});this.sync(true);}});
    this.video.addEventListener('waiting',()=>{if(this.isCurrent())this.patch({status:'buffering'});});
    this.video.addEventListener('playing',()=>{if(this.isCurrent())this.patch({status:'playing'});});
    audio.addEventListener('ratechange',()=>this.patch({rate:audio.playbackRate}));
    this.video.addEventListener('error',()=>this.recover('Video decoder or source unavailable'));
  }
  isCurrent(){return this.state.visible && this.state.status!=='closing' && !!this.active && (!this.video.currentSrc || this.video.currentSrc===this.active.href);}
  patch(value){if(value.status && value.status!==this.state.status)this.bufferingAt=value.status==='buffering'?this.now():null;this.state={...this.state,...value};this.changed(this.state);}
  setRate(rate){if(!VIDEO_RATES.includes(rate))throw new Error('Choose a supported playback speed');this.audio.preservesPitch=true;this.audio.playbackRate=rate;this.patch({rate});this.sync();}
  async open(id,{quality=80,origin,reduced=false}={}) {
    const initialPosition=!this.id || this.id===id?this.audio.currentTime*1000:0;
    const revision=++this.revision;++this.mediaRevision;this.active=null;this.abort?.abort();this.abort=new AbortController();this.video.pause();this.video.removeAttribute('src');this.video.load();clearTimeout(this.timer);
    this.id=id;this.origin=origin;this.reduced=reduced;this.failures.clear();this.recoveries=0;this.sample=null;this.candidates=[];
    this.clock(Number.isFinite(initialPosition)?Math.max(0,initialPosition):0);
    this.host.open(origin,reduced);this.patch({visible:true,status:'loading',error:'',codec:'',quality:0,label:'',qualities:[],background:this.hidden()});
    try {
      const data=await this.sourceFor(id,quality,this.abort.signal);if(revision!==this.revision)return false;
      const candidates=await this.capabilities.rank(data.streams || [],quality,this.abort.signal);if(revision!==this.revision)return false;
      if(!candidates.length)throw new Error('This browser does not support the available video codecs');this.candidates=candidates;
      const qualities=[...new Map((data.streams || []).map(row=>[row.quality,{id:row.quality,label:row.label}])).values()].sort((a,b)=>b.id-a.id);
      this.patch({qualities});this.load(candidates[0]);return true;
    }catch(error){if(revision!==this.revision || error.name==='AbortError')return false;this.patch({status:'error',error:error.message || 'Unable to load video. Return to audio to keep listening'});return false;}
  }
  load(stream) {
    ++this.mediaRevision;this.video.pause();this.sample=null;this.bufferingAt=this.now();this.lastSeekAt=-Infinity;this.active={...stream,href:new URL(stream.url,globalThis.location?.href || 'http://localhost/').href};this.video.src=this.active.href;this.video.muted=true;this.video.load();
    this.patch({status:'buffering',quality:stream.quality,label:stream.label,codec:stream.codec,width:stream.width,height:stream.height,error:''});this.sync(true);
  }
  recover(reason) {
    if(!this.isCurrent())return;
    this.failures.add(this.active.key);const next=this.candidates.find(row=>!this.failures.has(row.key));
    if(next && this.recoveries<3){++this.recoveries;this.load(next);return;}
    this.video.pause();clearTimeout(this.timer);this.patch({status:'error',error:reason+'，Audio can continue playing'});
  }
  sync(force=false) {
    clearTimeout(this.timer);this.timer=null;if(!this.state.visible || ['closing','error','loading'].includes(this.state.status))return;
    const background=this.hidden();if(background!==this.state.background)this.patch({background});
    this.clock(this.audio.currentTime*1000);
    if(background){this.bufferingAt=null;this.video.pause();return;}
    if(this.audio.paused || this.audio.ended)this.bufferingAt=null;
    else if(this.state.status==='buffering'){
      this.bufferingAt ??= this.now();
      if(this.now()-this.bufferingAt>20000){this.recover('Video buffering timed out');return;}
    }
    if(this.video.readyState>=1){const delta=this.audio.currentTime-this.video.currentTime;
      const now=this.now(),drift=Math.abs(delta),seekNow=drift>.04 && (force || drift>.75 && now-this.lastSeekAt>1200);
      if(seekNow){this.video.currentTime=Math.max(0,Math.min(this.audio.currentTime,Number.isFinite(this.video.duration)?this.video.duration:Infinity));this.lastSeekAt=now;}
      const corrected=drift>.08 && !seekNow && !this.audio.paused;
      const rate=Math.max(.25,Math.min(4,this.audio.playbackRate*(corrected?(delta>0?1.04:.96):1)));
      if(Math.abs(this.video.playbackRate-rate)>.002)this.video.playbackRate=rate;
      if(this.audio.paused || this.audio.ended){this.video.pause();return;}
      if(this.video.paused && this.playingPromise?.mediaRevision!==this.mediaRevision){const operation={revision:this.revision,mediaRevision:this.mediaRevision};this.playingPromise=operation;Promise.resolve(this.video.play()).catch(error=>{if(operation.mediaRevision===this.mediaRevision && this.isCurrent() && error.name!=='AbortError')this.patch({status:'error',error:'Tap Play to start the video'});}).finally(()=>{if(this.playingPromise===operation)this.playingPromise=null;if(!this.state.visible || this.state.status==='closing' || this.hidden() || this.audio.paused)this.video.pause();});}
    }
    if(this.audio.paused || this.audio.ended)return;
    const quality=this.video.readyState>=3 && !this.video.seeking?this.video.getVideoPlaybackQuality?.():null;const now=this.now();
    if(quality){if(this.sample && now-this.sample.at>=5000){const total=quality.totalVideoFrames-this.sample.total,dropped=quality.droppedVideoFrames-this.sample.dropped;this.sample={at:now,total:quality.totalVideoFrames,dropped:quality.droppedVideoFrames};if(total>50 && dropped/total>.2)this.recover('Current quality is consistently dropping frames');}else this.sample ||= {at:now,total:quality.totalVideoFrames,dropped:quality.droppedVideoFrames};}
    this.timer=setTimeout(()=>this.sync(),250);this.timer.unref?.();
  }
  close(origin=this.origin,reduced=this.reduced) {
    if(!this.state.visible || this.state.status==='closing')return;
    const revision=++this.revision;++this.mediaRevision;this.abort?.abort();clearTimeout(this.timer);this.video.pause();this.patch({status:'closing'});
    this.host.close(origin,reduced,()=>{if(revision!==this.revision)return;this.video.removeAttribute('src');this.video.load();this.active=null;this.patch({visible:false,status:'idle',error:''});});
  }
}

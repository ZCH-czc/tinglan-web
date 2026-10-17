import {hostSetTimeout,hostClearTimeout} from './host-api.mjs';
import {PlaybackRecovery,PLAYBACK_LIMITS,playbackFailure} from './playback-recovery.mjs';
import {playbackTask} from './playback-task.mjs';

/** One audible element. User intent, source ownership and automatic recovery have separate lifetimes. */
export class BrowserPlayback {
  constructor(engine,store,callbacks,{audio,events=globalThis.window,online=()=>globalThis.navigator?.onLine!==false,now=Date.now,setTimeout=hostSetTimeout,clearTimeout=hostClearTimeout,limits={}}={}) {
    Object.assign(this,{engine,store,callbacks,events,online,now});
    this.timers={setTimeout,clearTimeout};this.limits={...PLAYBACK_LIMITS,...limits};
    this.audio=audio || document.createElement('audio');this.audio.preload='metadata';this.audio.id='tinglan-audio';
    this.audio.setAttribute('aria-hidden','true');if(!audio)document.body.append(this.audio);
    this.revision=0;this.url=null;this.trackId='';this.desiredPlaying=false;this.pendingSeek=0;this.seekPending=false;
    this.status='idle';this.notice='';this.failed=false;this.policy=new PlaybackRecovery();this.retryNotBefore=0;
    this.audio.addEventListener('loadedmetadata',()=>{
      if(!this.sourceIsCurrent() || this.failed)return;
      const duration=Number.isFinite(this.audio.duration)?this.audio.duration*1000:0;
      if(duration>0)this.callbacks.duration(this.trackId,duration);
      this.applyPendingSeek();
    });
    this.audio.addEventListener('playing',()=>{
      if(!this.sourceIsCurrent())return;
      if(!this.desiredPlaying || this.suspended || this.waitingNetwork){this.audio.pause();return;}
      this.clearBuffer();this.failed=false;this.stable={at:this.now(),position:this.audio.currentTime};
      this.setNotice('');this.setStatus('playing');this.callbacks.recovered?.();
    });
    this.audio.addEventListener('pause',()=>{if(this.sourceIsCurrent() && !this.failed && !this.waitingNetwork){
      if(!this.audio.ended && this.desiredPlaying){this.desiredPlaying=false;this.clearBuffer();this.playAbort?.abort();this.callbacks.listeningFlush?.();}
      this.setStatus('paused');
    }});
    this.audio.addEventListener('waiting',()=>{if(this.sourceIsCurrent() && this.desiredPlaying && !this.failed && !this.suspended){this.stable=null;this.setStatus('buffering');this.armBuffer();}});
    this.audio.addEventListener('stalled',()=>{if(this.sourceIsCurrent() && this.desiredPlaying && !this.failed && !this.suspended)this.armBuffer();});
    this.audio.addEventListener('timeupdate',()=>{
      if(!this.sourceIsCurrent() || this.suspended || this.failed)return;
      this.listeningSample();this.engine.setPosition(this.audio.currentTime*1000);this.callbacks.time(this.audio.currentTime*1000);this.updatePositionState();
      if(this.buffer && this.audio.currentTime>this.buffer.position+.25){
        this.buffer.position=this.audio.currentTime;this.buffer.at=this.now();
        if(!this.audio.paused && this.audio.readyState>=3){this.clearBuffer();if(this.status==='buffering')this.setStatus('playing');}
      }
      if(this.status==='playing' && !this.audio.paused && this.stable && this.now()-this.stable.at>=this.limits.stableMs && this.audio.currentTime-this.stable.position>=.5){this.policy.reset();this.retryNotBefore=0;this.stable=null;}
    });
    this.audio.addEventListener('ended',()=>{
      if(!this.sourceIsCurrent() || this.suspended || !this.desiredPlaying || this.failed)return;
      this.clearBuffer();this.listeningSample();this.callbacks.listeningEnd?.();const next=this.engine.nextTrack(true);
      if(next)this.switchTo(next);else {this.desiredPlaying=false;this.setStatus('paused');}
    });
    this.audio.addEventListener('error',()=>{
      if(!this.sourceIsCurrent() || this.suspended || !this.audio.error)return;
      this.mediaFailure(this.audio.error.code);
    });
    for(const event of ['seeking','seeked','ratechange'])this.audio.addEventListener(event,()=>{this.stable=null;this.listeningSample(true);});
    this.onOnline=()=>{if(this.waitingNetwork && this.desiredPlaying && !this.suspended){
      this.waitingNetwork=false;
      if(this.policy.resumeNetwork())this.reload();else this.fail('Connection not restored. Tap Play to retry');
    }};
    events?.addEventListener?.('online',this.onOnline);this.bindMediaSession();
  }
  setNotice(message){if(this.notice===message)return;this.notice=message;this.callbacks.notice?.(message);}
  listeningSample(discontinuity=false) {
    if(!this.url || this.audio.src!==this.url)return;
    this.callbacks.listening?.({id:this.trackId,position:this.position(),rate:this.audio.playbackRate,active:this.status==='playing' && !this.audio.paused && !this.audio.seeking && !this.suspended && !this.failed},{discontinuity});
  }
  sourceIsCurrent(){return !!this.url && this.audio.src===this.url && this.engine.currentId()===this.trackId;}
  owns(revision){return revision===this.revision && this.engine.currentId()===this.trackId && !this.suspended;}
  position(){return this.seekPending?this.pendingSeek:this.sourceIsCurrent() && !this.failed?this.audio.currentTime*1000:(this.engine.positionMs?.() ?? this.pendingSeek);}
  applyPendingSeek(){if(this.seekPending && this.audio.readyState>=1 && Number.isFinite(this.audio.duration) && this.audio.duration>0){this.audio.currentTime=Math.min(this.pendingSeek/1000,this.audio.duration);this.pendingSeek=0;this.seekPending=false;}}
  setStatus(status) {
    if(this.suspended && status==='playing'){this.audio.pause();return;}
    this.listeningSample();this.status=status;this.listeningSample();
    if(globalThis.navigator?.mediaSession && !this.suspended)navigator.mediaSession.playbackState=status==='playing'?'playing':status==='idle'?'none':'paused';
    this.callbacks.state(status);
  }
  clearBuffer(){if(this.bufferTimer!=null)this.timers.clearTimeout(this.bufferTimer);this.bufferTimer=null;this.buffer=null;}
  cancelWork(){
    this.clearBuffer();this.playAbort?.abort();this.playAbort=null;this.probeAbort?.abort();this.probeAbort=null;
    if(this.delayTimer!=null)this.timers.clearTimeout(this.delayTimer);this.delayTimer=null;
    this.sourceAbort?.abort();this.handling=null;this.waitingNetwork=false;this.stable=null;
  }
  armBuffer(){
    if(this.buffer || !this.desiredPlaying || this.suspended || this.failed || !this.url)return;
    const watch=this.buffer={revision:this.revision,at:this.now(),position:this.audio.currentTime};
    const check=()=>{
      this.bufferTimer=null;if(this.buffer!==watch || !this.owns(watch.revision) || !this.desiredPlaying)return;
      const remaining=this.limits.bufferMs-(this.now()-watch.at);
      if(remaining>0){this.bufferTimer=this.timers.setTimeout(check,remaining);this.bufferTimer?.unref?.();return;}
      this.clearBuffer();this.mediaFailure(2,Object.assign(new Error('Buffering is taking too long. Checking playback source'),{code:'buffer-timeout'}));
    };
    this.bufferTimer=this.timers.setTimeout(check,this.limits.bufferMs);this.bufferTimer?.unref?.();
  }
  metadata(){return this.callbacks.metadata?.(this.trackId) || JSON.parse(this.engine.currentTrackJson());}
  releaseSource(){const url=this.url,owned=this.ownedUrl;this.url=null;this.audio.pause();this.audio.removeAttribute('src');this.audio.load();if(url && owned)URL.revokeObjectURL(url);this.ownedUrl=false;}
  async switchTo(id,{play=true,position=0}={}){return this.select(id,{play,position},false);}
  async select(id,{play=true,position=0}={},chain=false){
    this.listeningSample();if(!this.engine.selectTrack(id))return false;
    this.callbacks.listeningEnd?.();this.suspended=null;++this.revision;this.cancelWork();
    if(!chain){this.policy.reset();this.retryNotBefore=0;this.setNotice('');}
    this.trackId=id;this.desiredPlaying=play;this.failed=false;this.releaseSource();this.pendingSeek=position;this.seekPending=true;this.engine.setPosition(position);
    this.setStatus(play?'buffering':'paused');this.callbacks.track(id);this.callbacks.listeningBegin?.(this.metadata());
    return this.loadSource(this.revision,'selection');
  }
  async loadSource(revision,kind){
    this.loadKind=kind;const controller=this.sourceAbort=new AbortController();
    try {
      const value=await playbackTask(()=>this.store.sourceFor?this.store.sourceFor(this.trackId,controller.signal):this.store.read('media',this.trackId),{signal:controller.signal,timeoutMs:this.limits.sourceMs,timers:this.timers});
      if(!this.owns(revision))return false;
      if(!(value instanceof Blob) && !value?.url)throw Object.assign(new Error('Audio file missing. Import it again'),{code:'missing-local'});
      this.ownedUrl=value instanceof Blob;this.url=this.ownedUrl?URL.createObjectURL(value):new URL(value.url,globalThis.location?.href || 'http://localhost/').href;
      this.failed=false;this.audio.src=this.url;this.audio.load();this.applyPendingSeek();this.updateMediaMetadata();
      if(this.desiredPlaying){this.armBuffer();await this.play(revision);}
      return this.owns(revision);
    }catch(error){
      if(this.owns(revision) && error.name!=='AbortError')this.handleFailure(error,{revision});return false;
    }finally{if(this.owns(revision))this.loadKind='';}
  }
  async play(revision=this.revision){
    if(this.suspended)return;
    if(this.url && !this.sourceIsCurrent()){await this.retry();return;}
    if(this.failed || this.waitingNetwork || this.status==='error'){await this.retry();return;}
    this.desiredPlaying=true;
    if(!this.url)return;
    this.setStatus('buffering');this.armBuffer();
    if(!this.sourceAbort || this.sourceAbort.signal.aborted)this.sourceAbort=new AbortController();
    this.playAbort?.abort();const playController=this.playAbort=new AbortController();
    let nativePlay;try{nativePlay=this.beforePlay?Promise.resolve(this.beforePlay(this.audio)).then(()=>{if(!this.owns(revision) || !this.desiredPlaying || playController.signal.aborted)throw new DOMException('Playback intent changed','AbortError');return this.audio.play();}):Promise.resolve(this.audio.play());}catch(error){nativePlay=Promise.reject(error);}
    // A late native play resolution still must obey the latest global pause/live intent.
    nativePlay.then(()=>{if(!this.desiredPlaying || this.suspended || this.waitingNetwork)this.audio.pause();},()=>{});
    try {await playbackTask(()=>nativePlay,{signal:AbortSignal.any([this.sourceAbort.signal,playController.signal]),timers:this.timers});}
    catch(error){
      if(this.owns(revision) && this.desiredPlaying && error.name!=='AbortError' && this.handling!==revision && !this.failed){
        // Chromium can reject play() with NotSupportedError for an HTTP 410 while
        // the element's error event is still awaiting its companion diagnosis.
        if(this.audio.error || error.name==='NotSupportedError')await this.mediaFailure(this.audio.error?.code || 4,error);
        else this.handleFailure(error,{revision});
      }
    }
    finally{if(this.playAbort===playController)this.playAbort=null;}
    if(!this.desiredPlaying || this.suspended || this.waitingNetwork)this.audio.pause();
  }
  async mediaFailure(mediaCode,error={}){
    const revision=this.revision;if(this.handling===revision || this.failed || !this.sourceIsCurrent() || this.suspended)return;
    this.handling=revision;this.listeningSample();const position=this.position();this.engine.setPosition(position);this.pendingSeek=position;this.seekPending=true;this.failed=true;this.clearBuffer();this.stable=null;
    let issue=error;
    if(!this.ownedUrl && this.store.diagnose){
      this.setNotice('Checking playback connection…');this.setStatus('buffering');const controller=this.probeAbort=new AbortController();
      try{const result=await playbackTask(()=>this.store.diagnose(this.url,controller.signal),{signal:controller.signal,timeoutMs:this.limits.diagnosticMs,timers:this.timers,code:'diagnostic-timeout'});if(result?.failure)issue=result.failure;}
      catch(error){if(typeof error.code==='string' && error.status)issue=error;}
      finally{controller.abort();if(this.probeAbort===controller)this.probeAbort=null;}
    }
    if(this.owns(revision)){this.handling=null;this.handleFailure(issue,{mediaCode,revision});}
  }
  hasNext(){const at=this.engine.currentQueueIndex?.(),total=this.engine.queueSize?.();return Number.isInteger(at) && at>=0 && at+1<total;}
  handleFailure(error,{mediaCode=0,revision=this.revision}={}){
    if(!this.owns(revision))return;
    const local=this.url?this.ownedUrl:this.metadata()?.source==='local';
    const failure=playbackFailure(error,{mediaCode,offline:!this.online(),local});
    const action=this.policy.decide(this.trackId,failure,{hasNext:this.hasNext(),playing:this.desiredPlaying});
    this.listeningSample();const position=this.position();this.engine.setPosition(position);this.pendingSeek=position;this.seekPending=true;
    this.failed=true;this.audio.pause();this.clearBuffer();this.stable=null;
    if(action==='wait'){
      if(this.policy.networkResumes>=PLAYBACK_LIMITS.networkResumes){this.fail('Still offline. Connect and tap Play to retry');return;}
      ++this.revision;this.cancelWork();this.waitingNetwork=true;this.setNotice(failure.message);this.setStatus('waiting-network');return;
    }
    if(action==='refresh' || action==='skip'){
      const owner=++this.revision;this.cancelWork();
      this.setNotice(action==='refresh'?failure.message:`Unable to connect. Trying the next track（${this.policy.skipped}/${PLAYBACK_LIMITS.skips}）`);this.setStatus('buffering');
      this.delayTimer=this.timers.setTimeout(()=>{
        this.delayTimer=null;if(!this.owns(owner) || !this.desiredPlaying)return;
        if(action==='refresh')this.reload();else {const next=this.engine.nextTrack(false);if(next)this.select(next,{play:true,position:0},true);else this.fail('Unable to continue this queue. Retry later');}
      },this.limits.backoffMs);this.delayTimer?.unref?.();return;
    }
    if(failure.retryAfter)this.retryNotBefore=this.now()+failure.retryAfter*1000;
    this.fail(failure.kind==='recoverable'?'Content unavailable. Automatic retries stopped; retry manually or choose another track':failure.message,failure.kind==='gesture'?'paused':'error');
  }
  fail(message,status='error'){
    ++this.revision;this.cancelWork();this.failed=true;this.desiredPlaying=false;this.audio.pause();this.setNotice('');this.setStatus(status);this.callbacks.error(message);
  }
  async reload(){
    if(this.suspended || !this.desiredPlaying)return false;
    const position=this.position();this.listeningSample(true);++this.revision;this.cancelWork();this.releaseSource();this.pendingSeek=position;this.seekPending=true;this.engine.setPosition(position);
    this.failed=false;this.setStatus('buffering');return this.loadSource(this.revision,'recovery');
  }
  async retry(){
    if(this.suspended || !this.engine.currentId())return false;
    if(this.retryNotBefore>this.now()){this.callbacks.error(`Platform requests are cooling down. Retry in ${Math.ceil((this.retryNotBefore-this.now())/1000)} seconds`);return false;}
    this.policy.reset();this.desiredPlaying=true;this.setNotice('Reconnecting while keeping your position…');this.callbacks.recovered?.();
    if(!this.trackId || this.trackId!==this.engine.currentId())return this.select(this.engine.currentId(),{play:true,position:this.engine.positionMs?.() || 0});
    return this.reload();
  }
  suspend(){
    this.listeningSample();const token={id:this.engine.currentId(),position:this.position(),playing:this.desiredPlaying};
    this.suspended=token;++this.revision;this.cancelWork();this.pause();return token;
  }
  async resume(token,{play=true}={}){
    if(!token || this.suspended!==token || this.engine.currentId()!==token.id)return false;this.suspended=null;
    if(!token.id){this.setStatus('idle');if(globalThis.navigator?.mediaSession)navigator.mediaSession.metadata=null;return false;}
    if(this.sourceIsCurrent() && !this.failed){this.seek(token.position);this.updateMediaMetadata();if(play && token.playing)await this.play();else this.setStatus('paused');return true;}
    return this.switchTo(token.id,{position:token.position,play:play && token.playing});
  }
  pause(){
    this.listeningSample();this.desiredPlaying=false;this.playAbort?.abort();this.clearBuffer();this.waitingNetwork=false;this.stable=null;
    if(this.delayTimer!=null || this.probeAbort || this.loadKind==='recovery'){++this.revision;this.cancelWork();this.failed=true;}
    this.setNotice('');this.audio.pause();this.setStatus('paused');this.callbacks.listeningFlush?.();
  }
  toggle(){if(this.desiredPlaying)this.pause();else if(this.failed || this.waitingNetwork || this.status==='error')this.retry();else if(this.url)this.play();else if(this.engine.currentId())this.retry();}
  next(){this.listeningSample();const id=this.engine.nextTrack(false);if(id)this.switchTo(id);}
  previous(){this.listeningSample();const id=this.engine.previousTrack();if(id)this.switchTo(id);}
  seek(ms){
    this.listeningSample();this.stable=null;const position=this.engine.setPosition(ms);
    if(this.audio.readyState>=1 && this.sourceIsCurrent() && !this.failed){try{this.audio.currentTime=position/1000;this.seekPending=false;}catch{this.pendingSeek=position;this.seekPending=true;}}
    else {this.pendingSeek=position;this.seekPending=true;}
    if(this.buffer){this.buffer.at=this.now();this.buffer.position=this.audio.currentTime;}
    this.listeningSample(true);this.callbacks.time(position);this.updatePositionState();
  }
  setVolume(value){this.audio.volume=Math.max(0,Math.min(1,Number(value) || 0));}
  stop(){
    this.listeningSample();this.callbacks.listeningEnd?.();this.suspended=null;++this.revision;this.cancelWork();
    this.desiredPlaying=false;this.releaseSource();this.trackId='';this.pendingSeek=0;this.seekPending=false;this.failed=false;this.policy.reset();this.retryNotBefore=0;this.setNotice('');this.setStatus('idle');
    if(globalThis.navigator?.mediaSession)navigator.mediaSession.metadata=null;
  }
  dispose(){this.stop();this.events?.removeEventListener?.('online',this.onOnline);}
  updateMediaMetadata(artworkUrl) {
    if(this.suspended)return;
    if (!('mediaSession' in navigator) || !globalThis.MediaMetadata) return;
    const track = this.callbacks.metadata?.(this.trackId) || JSON.parse(this.engine.currentTrackJson()); if (!track) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title, artist: track.artist, album: track.album || `Tinglan · ${{qq:'QQ Music',bili:'Bilibili',netease:'NetEase Music'}[track.source] || 'Local music'}`,
      artwork: artworkUrl ? [{ src: artworkUrl, sizes: '640x640', type: 'image/webp' }] : [],
    });
  }
  updatePositionState() {
    if(this.suspended)return;
    if (!navigator.mediaSession?.setPositionState || !Number.isFinite(this.audio.duration) || this.audio.duration <= 0) return;
    try { navigator.mediaSession.setPositionState({ duration: this.audio.duration, position: Math.min(this.audio.currentTime, this.audio.duration), playbackRate: this.audio.playbackRate }); } catch { /* Optional browser capability. */ }
  }
  bindMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const handlers = {
      play: () => this.play(), pause: () => this.pause(), nexttrack: () => this.next(), previoustrack: () => this.previous(),
      seekto: event => this.seek(event.seekTime * 1000),
      seekbackward: event => this.seek((this.audio.currentTime - (event.seekOffset || 10)) * 1000),
      seekforward: event => this.seek((this.audio.currentTime + (event.seekOffset || 10)) * 1000),
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try { navigator.mediaSession.setActionHandler(action, event=>{this.callbacks.intent?.();if(!this.mediaDelegate?.(action,event))handler(event);}); } catch { /* Not all actions are supported. */ }
    }
  }
}

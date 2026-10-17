import {hostSetTimeout,hostClearTimeout} from './host-api.mjs';
import {radioStation,RADIO_LIMITS} from './radio-data.mjs';

/** Broadcasts own a separate audio decoder and never enter the finite music queue/cache. */
export class RadioPlayback {
  constructor({audio,music,source,attachHls,revoke=()=>{},changed=()=>{},recent=()=>{},setTimer=hostSetTimeout,clearTimer=hostClearTimeout}) {Object.assign(this,{audio,music,source,attachHls,revoke,changed,recent,setTimer,clearTimer});this.revision=0;this.active=false;this.desired=false;this.state={active:false,status:'idle',station:null,error:'',queue:[]};
    for(const [event,status] of [['playing','playing'],['waiting','buffering'],['pause','paused']])audio.addEventListener(event,()=>{if(!this.active || this.detaching || !this.adapter)return;if(status==='paused' && !audio.paused || status==='playing' && audio.paused || status==='buffering' && audio.paused)return;if(event==='playing' && (!this.desired || this.interruption)){audio.pause();return;}this.patch({status});});
    audio.addEventListener('error',()=>{if(!this.active || this.detaching || !this.adapter)return;if(audio.error?.code===2 && this.recovery<3 && this.desired && !this.interruption){const n=++this.recovery;this.release();this.patch({status:'buffering',error:`Station connection lost. Reconnecting（${n}/3）`});this.retry=this.setTimer(()=>this.open(this.state.station,{queue:this.state.queue,recovery:n,count:false}),[1000,3000,7000][n-1]);this.retry?.unref?.();}else this.fail('Station unavailable. Retry or choose another station');});
    audio.addEventListener('ended',()=>{if(this.active && !this.detaching && this.adapter)this.fail('Audio stream ended. You can reconnect');});
  }
  patch(value){this.state={...this.state,...value,active:this.active};this.clearTimer(this.watchdog);if(['loading','buffering'].includes(this.state.status) && !this.interruption){this.watchdog=this.setTimer(()=>this.fail('Station buffering timed out. Check your network and retry'),30000);this.watchdog?.unref?.();}this.changed(this.state);}
  release(){this.detaching=true;this.clearTimer(this.watchdog);this.clearTimer(this.retry);this.adapter?.destroy();this.adapter=null;this.audio.pause();this.audio.removeAttribute('src');this.audio.load();this.detaching=false;if(this.url)Promise.resolve(this.revoke(this.url)).catch(()=>{});this.url='';}
  async open(value,{queue=[value],play=true,recovery=0,count=true}={}) {
    let station;try{station=radioStation(value);queue=queue.slice(0,RADIO_LIMITS.queue).map(radioStation);if(!queue.some(row=>row.uuid===station.uuid))queue=[station];}catch(error){this.patch({error:error.message});return false;}
    if(!this.active){this.musicToken=this.music.suspend();this.active=true;}this.interruption=null;this.desired=play;this.recovery=recovery;
    const revision=++this.revision;this.abort?.abort();this.abort=new AbortController();this.release();this.patch({station,queue,status:play?'loading':'paused',error:''});this.metadata();
    if(!play)return true;
    try{const result=await this.source(station,this.abort.signal,{count});if(revision!==this.revision){if(result?.url)this.revoke(result.url);return false;}if(typeof result?.url!=='string' || !/^\/api\/radio-media\/[a-f0-9]{48}\/[a-f0-9]{40}$/.test(result.url))throw new Error('Invalid station source');this.url=result.url;
      const adapter=result.hls?await this.attachHls(this.audio,result.url,error=>{if(revision===this.revision)this.fail(String(error).replaceAll('Live','Radio').replaceAll('Try another quality','Choose another station'));},this.abort.signal):{destroy:()=>{this.audio.pause();this.audio.removeAttribute('src');this.audio.load();}};
      if(revision!==this.revision){adapter.destroy();return false;}this.adapter=adapter;
      if(!result.hls){this.audio.src=result.url;this.audio.load();}
      this.audio.volume=this.music.audio.volume;if(!this.desired || this.interruption){this.release();this.patch({status:'paused'});return false;}this.patch({status:'buffering'});if(this.beforePlay)await this.beforePlay(this.audio);if(revision!==this.revision || !this.desired || this.interruption)return false;await this.audio.play();
      if(revision===this.revision && this.desired && !this.interruption){Promise.resolve(this.recent(station)).catch(()=>{});return true;}if(!this.desired || this.interruption)this.audio.pause();return false;
    }catch(error){if(revision===this.revision && error.name!=='AbortError'){this.desired=false;this.release();this.patch({status:error.name==='NotAllowedError'?'paused':'error',error:error.name==='NotAllowedError'?'Tap Play to allow the browser to start this station':error.message || 'Station connection failed'});}return false;}
  }
  fail(error){if(!this.active)return;this.desired=false;++this.revision;this.abort?.abort();this.release();this.patch({status:'error',error});}
  pause(){if(!this.active)return;this.desired=false;++this.revision;this.abort?.abort();this.release();this.patch({status:'paused'});}
  play(){if(this.active && !this.interruption)return this.open(this.state.station,{queue:this.state.queue,count:false});return Promise.resolve(false);}
  toggle(){if(this.desired)this.pause();else return this.play();}
  change(direction){const rows=this.state.queue;if(rows.length<2 || this.interruption)return;const at=rows.findIndex(row=>row.uuid===this.state.station?.uuid);return this.open(rows[(at+(direction<0?-1:1)+rows.length)%rows.length],{queue:rows});}
  suspend(){if(!this.active)return null;const token={uuid:this.state.station.uuid,playing:this.desired};this.pause();this.interruption=token;return token;}
  async resume(token,{play=true}={}){if(!token || this.interruption!==token || !this.active || this.state.station?.uuid!==token.uuid)return false;this.interruption=null;if(play && token.playing)return this.play();this.metadata();this.patch({status:'paused'});return true;}
  async close({resume=true}={}){if(!this.active)return;this.active=false;this.desired=false;this.interruption=null;++this.revision;this.abort?.abort();this.release();const token=this.musicToken;this.musicToken=null;this.patch({station:null,queue:[],status:'idle',error:''});await this.music.resume(token,{play:resume});}
  metadata(){if(!navigator.mediaSession || !globalThis.MediaMetadata || !this.active || this.interruption)return;const s=this.state.station;navigator.mediaSession.metadata=new MediaMetadata({title:s.name,artist:`FM Live · ${s.region || s.countryCode || 'Internet radio'}`,album:'Tinglan'});try{navigator.mediaSession.setPositionState?.();}catch{}}
}

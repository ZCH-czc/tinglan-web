import {tr} from './i18n.mjs';
import {LISTENING_LIMITS,normalizeListening} from './listening-data.mjs';

/** Actual advancing media time is bounded by monotonic elapsed time, never by play intent. */
export class ListeningRecorder {
  constructor(save,{monotonic=()=>performance.now(),wall=()=>Date.now(),changed=()=>{},error=()=>{},uuid=()=>crypto.randomUUID()}={}) {Object.assign(this,{save,monotonic,wall,changed,error,uuid});this.enabled=true;this.pending=new Map();this.failed=new Map();this.generation=0;this.lastSave=0;}
  begin(track) {
    this.finish();if(!this.enabled || !track?.id)return;
    this.track=track;this.current={id:this.uuid(),songId:track.id,title:String(track.title || tr("Untitled track")).slice(0,2000),artist:String(track.artist || tr("Unknown artist")).slice(0,2000),album:String(track.album || '').slice(0,2000),source:track.source || 'local',creatorId:String(track.creatorId || '').slice(0,40),creatorName:String(track.creatorName || '').slice(0,2000),startedAt:Math.floor(this.wall()),segments:[],totalMs:0};this.anchor=null;
  }
  observe(sample,{discontinuity=false}={}) {
    if(!this.enabled || !this.current || sample.id!==this.current.songId)return;
    const now=this.monotonic(),wall=Math.floor(this.wall()),previous=this.anchor;
    if(previous && Math.abs(wall-previous.wall-(now-previous.now))>=5000){this.begin(this.track);this.anchor={now,wall,position:sample.position,rate:sample.rate || 1,active:sample.active===true};return;}
    if(!discontinuity && previous?.active) {
      const elapsed=now-previous.now,advance=(sample.position-previous.position)/previous.rate;
      if(elapsed>0 && elapsed<=LISTENING_LIMITS.observationGap && advance>=0 && advance<=elapsed+1000 && Math.abs(wall-previous.wall-elapsed)<5000) {
        const ms=Math.floor(Math.min(elapsed,advance));
        if(ms>0){if(wall-this.current.startedAt>LISTENING_LIMITS.span || this.current.segments.length>=LISTENING_LIMITS.segments || wall<previous.wall){const track=this.track;this.begin(track);this.current.startedAt=wall-ms;}const at=Math.max(this.current.startedAt,wall-ms),rows=this.current.segments,last=rows.at(-1);if(last && at<=last[0]+last[1]+1){const extra=Math.max(0,at+ms-last[0]-last[1]);last[1]+=extra;this.current.totalMs+=extra;}else{rows.push([at,ms]);this.current.totalMs+=ms;}}
      }
    }
    this.anchor={now,wall,position:sample.position,rate:Number.isFinite(sample.rate)&&sample.rate>0?sample.rate:1,active:sample.active===true && Number.isFinite(sample.position)};
    if(this.current.totalMs>=LISTENING_LIMITS.threshold && now-this.lastSave>=10000){this.lastSave=now;this.queue();}
  }
  queue() {for(const [id,entry] of this.failed)this.pending.set(id,entry);this.failed.clear();if(this.current && this.current.totalMs>=LISTENING_LIMITS.threshold)this.pending.set(this.current.id,{row:normalizeListening(this.current),generation:this.generation});if(this.pending.size)this.drain();}
  async drain() {if(this.saving)return this.saving;this.saving=(async()=>{while(this.pending.size){const [id,entry]=this.pending.entries().next().value;this.pending.delete(id);if(entry.generation!==this.generation)continue;try{const accepted=await this.save(entry.row);if(accepted!==false && entry.generation===this.generation)this.changed();}catch(error){if(entry.generation===this.generation){this.failed.set(id,entry);while(this.failed.size>32)this.failed.delete(this.failed.keys().next().value);this.error(error);}}}})().finally(()=>{this.saving=null;if(this.pending.size)this.drain();});return this.saving;}
  finish() {this.queue();this.current=null;this.anchor=null;}
  async flush() {this.queue();while(this.saving || this.pending.size)await this.drain();if(this.failed.size)throw new Error(tr("Listening statistics not saved. Restore local storage and retry"));}
  reset() {++this.generation;this.pending.clear();this.failed.clear();this.current=null;this.anchor=null;}
  setEnabled(value,track) {this.finish();this.enabled=value===true;if(this.enabled && track)this.begin(track);}
}

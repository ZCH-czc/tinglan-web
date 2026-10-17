import {BackgroundDownloadClient} from './background-download-client.mjs';
import {CacheStore} from './cache-storage.mjs';
import {DownloadQueue} from './download-queue.mjs';
import {CachePressure,cacheBudget,cacheKind,cachePatch} from './cache-policy.mjs';
import {hostSetTimeout,hostClearTimeout} from './host-api.mjs';

export class MediaCache {
  constructor({store,record,ensure,source,revoke,lyrics,artwork,resize,preferences,protectedIds,changed=()=>{},committed=()=>{},estimate=async()=>({}),visible=()=>true,networkAllowed=()=>true,now=Date.now,setTimer=hostSetTimeout,clearTimer=hostClearTimeout,fetcher,workerContainer,notify=()=>false}){
    Object.assign(this,{store,record,ensure,lyrics,artwork,resize,preferences,protectedIds,changed,committed,estimate,visible,networkAllowed,now,setTimer,clearTimer});
    this.cache=new CacheStore(store);this.pressure=new CachePressure();this.info={loading:false,cleaning:false,warning:''};this.tasks=[];this.revision=0;this.autoAttempt=new Set();this.touches=new Map();
    this.queue=new DownloadQueue({ensure:async id=>{const row=await ensure(id);if(['automatic','download'].includes(cacheKind(row))){const audio=await store.read('media',id);if(!(audio instanceof Blob) || audio.size!==row.size)return {...row,cached:false,cacheMode:'',size:0};}return row;},resolve:source,revoke,fetcher,estimate,now,setTimer,clearTimer,assets:(id,signal)=>this.assets(id,signal),save:(id,blob,options)=>this.cache.save(id,blob,{...options,limit:cacheBudget(preferences().cacheLimitMb),protectedIds,keepFavorites:preferences().cacheKeepFavorites}),committed:result=>{this.apply(result);this.refresh().catch(()=>{});},changed:rows=>{this.foregroundTasks=rows;this.tasks=[...rows,...(this.backgroundTasks || [])];changed();}});
  }
  async startBackground(container,notify=()=>false){
    if(!container || this.background)return;this.background=new BackgroundDownloadClient({container,ensure:this.ensure,assets:(id,signal)=>this.assets(id,signal),notify,changed:rows=>{this.backgroundTasks=rows;this.tasks=[...(this.foregroundTasks || []),...rows];this.changed();},committed:()=>this.refresh().catch(()=>{})});container.addEventListener('controllerchange',()=>this.background.start());await this.background.start();
  }
  view(){return {...this.info,autoEnabled:this.preferences().autoCache,limitMb:this.preferences().cacheLimitMb,keepFavorites:this.preferences().cacheKeepFavorites,notice:this.pressure.notice,active:this.tasks.find(row=>['queued','preparing','downloading','saving'].includes(row.status)) || null};}
  apply(result){if(result.updates?.length)this.committed(result.updates);}
  async refresh(){
    const revision=++this.revision;this.info={...this.info,loading:true};this.changed();
    try{const [scan,space]=await Promise.all([this.cache.inspect(),this.estimate().catch(()=>({}))]);const {cacheRecords,...totals}=scan;if(revision!==this.revision)return totals;
      const changes=cacheRecords.filter(row=>this.record(row.id) && JSON.stringify(cachePatch(row))!==JSON.stringify(cachePatch(this.record(row.id))));if(changes.length)this.committed(changes);
      this.pressure.observe(totals.automaticBytes,cacheBudget(this.preferences().cacheLimitMb));this.info={...this.info,...totals,usage:space.usage || 0,quota:space.quota || 0,loading:false,warning:''};this.changed();return totals;
    }catch(error){if(revision===this.revision){this.info={...this.info,loading:false,warning:error.message || 'Storage statistics unavailable'};this.changed();}return null;}
  }
  async assets(id,signal){
    const row=this.record(id),result={},missing=[];if(!row)throw new Error('Track removed');
    const operations=[];
    if(!row.lyrics && !row.lyricsEdited)operations.push((async()=>{try{const value=await this.lyrics(id,signal,row);signal.throwIfAborted();if(typeof value?.text==='string' && value.text.length>0 && value.text.length<=200000)result.lyrics=value;else missing.push('Lyrics');}catch(error){signal.throwIfAborted();missing.push('Lyrics');}})());
    operations.push((async()=>{try{const [full,thumb]=await Promise.all([this.store.read('artwork',id),this.store.read('artwork',id+':thumb')]);signal.throwIfAborted();if(full instanceof Blob && thumb instanceof Blob)return;const blob=full instanceof Blob?full:await this.artwork(id,signal);signal.throwIfAborted();result.artwork=await this.resize(blob);signal.throwIfAborted();}catch(error){signal.throwIfAborted();missing.push('Artwork');}})());
    await Promise.all(operations);signal.throwIfAborted();if(missing.length)result.warning=missing.join(', ')+' could not be retrieved. Audio is kept.';return result;
  }
  request(id,mode='download'){
    if(mode==='download' && this.background?.supported){this.clearTimer(this.autoTimer);this.queue.cancelAutomatic();return this.background.enqueue(id);}
    const row=this.record(id);return this.queue.enqueue(id,{mode,title:row?.title || id});
  }
  async cancel(id){if(this.background?.supported)await this.background.cancel(id);const job=this.queue.jobs.get(id);if(!job)return;this.queue.cancel(id);await job.promise.catch(()=>{});}
  async cancelAll(){this.resetAutomatic();await this.background?.cancel();await this.queue.clear();}
  async clean(id=''){
    if(this.info.cleaning)throw new Error('Clearing cache. Please wait');
    this.info={...this.info,cleaning:true,warning:''};this.changed();
    try{
      if(id)await this.cancel(id);else{const active=[...this.queue.jobs.values()].filter(row=>row.mode==='automatic');this.queue.cancelAutomatic();await Promise.all(active.map(row=>row.promise.catch(()=>{})));}
      const result=await this.cache.clean({ids:id?[id]:undefined,target:0,protectedIds:this.protectedIds,keepFavorites:this.preferences().cacheKeepFavorites});this.apply(result);await this.refresh();return result;
    }finally{this.info={...this.info,cleaning:false};this.changed();}
  }
  maintain(){
    if(this.maintenance){this.maintenanceAgain=true;return this.maintenance;}
    this.maintenance=(async()=>{do{this.maintenanceAgain=false;await this.trim();}while(this.maintenanceAgain);})().catch(error=>{this.info={...this.info,warning:'Automatic cleanup incomplete. Retry on the cache page later'};this.changed();throw error;}).finally(()=>{this.maintenance=null;});return this.maintenance;
  }
  async trim(){
    const totals=await this.refresh(),limit=cacheBudget(this.preferences().cacheLimitMb);
    if(!totals || this.info.cleaning || !Number.isFinite(limit) || totals.automaticBytes<=limit)return;
    this.info={...this.info,cleaning:true};this.changed();
    try{const result=await this.cache.clean({target:limit*.85,protectedIds:this.protectedIds,keepFavorites:this.preferences().cacheKeepFavorites});this.apply(result);await this.refresh();if(result.blocked){this.info={...this.info,warning:'Current, next, and retained favorite tracks are protected from cleanup'};this.changed();}}
    finally{this.info={...this.info,cleaning:false};this.changed();}
  }
  acknowledge(token){this.pressure.acknowledge(token);this.changed();}
  async missing(id){const result=await this.cache.missing(id);this.apply(result);if(result.updates.length)await this.refresh();}
  touch(id){
    if(cacheKind(this.record(id))!=='automatic')return;
    const at=this.now();if(at-(this.touches.get(id) || 0)<60000)return;
    this.touches.delete(id);this.touches.set(id,at);while(this.touches.size>256)this.touches.delete(this.touches.keys().next().value);
    this.cache.touch(id,at).then(()=>{const row=this.record(id);if(row)row.cacheTouchedAt=at;}).catch(()=>{});
  }
  playback(id,playing){
    const eligible=playing && this.preferences().autoCache && cacheBudget(this.preferences().cacheLimitMb)>0 && this.visible() && this.networkAllowed() && !this.backgroundTasks?.some(row=>['queued','preparing','downloading','saving'].includes(row.status));
    this.clearTimer(this.autoTimer);this.queue.cancelAutomatic(eligible?id:'');
    if(!eligible || cacheKind(this.record(id)) || !['qq','bili','netease'].includes(this.record(id)?.source) || this.autoAttempt.has(id))return;
    this.autoTimer=this.setTimer(()=>{
      if(!this.visible() || !this.networkAllowed() || !this.preferences().autoCache)return;
      this.autoAttempt.add(id);while(this.autoAttempt.size>256)this.autoAttempt.delete(this.autoAttempt.values().next().value);
      this.request(id,'automatic').catch(()=>{});
    },6000);
  }
  resetAutomatic(){this.autoAttempt.clear();this.playback('',false);}
  async leave(){this.resetAutomatic();await this.queue.clear();}
  async clear(){this.resetAutomatic();await this.background?.clear();await this.queue.clear();}
}

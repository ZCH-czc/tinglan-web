import {tr} from './i18n.mjs';
import {hostFetch,hostSetTimeout,hostClearTimeout} from './host-api.mjs';
import {CACHE_LIMITS,cacheKind} from './cache-policy.mjs';
import {hasAudioHeader} from './lan-transfer-policy.mjs';

const audioTypes=['mp3','m4a','aac','flac','wav','ogg','opus','aiff','ape','wma'];
const cancelled=()=>new DOMException(tr("Cache task cancelled"),'AbortError');
/** One bounded, cancelable transfer queue; navigation/favorites never take its lock. */
export class DownloadQueue {
  constructor({ensure,resolve,save,revoke=async()=>{},assets=async()=>({}),changed=()=>{},committed=()=>{},estimate=async()=>({}),fetcher=hostFetch,now=Date.now,setTimer=hostSetTimeout,clearTimer=hostClearTimeout,limits={}}){
    Object.assign(this,{ensure,resolve,save,revoke,assets,changed,committed,estimate,fetcher,now,setTimer,clearTimer});this.limits={...CACHE_LIMITS,...limits};this.jobs=new Map();this.history=[];this.active=null;this.revision=0;
  }
  rows(){return [...this.jobs.values(),...this.history].slice(0,this.limits.history+this.limits.queue).map(({id,title,mode,status,done,total,error,warning})=>({id,title,mode,status,done,total,progress:total>0?Math.min(1,done/total):0,error,warning}));}
  emit(){this.changed(this.rows());}
  enqueue(id,{mode='download',title=id}={}){
    if(!/^(?:qq|bili|netease)-[A-Za-z0-9_-]{1,190}$/.test(id))return Promise.reject(new Error(tr("Choose a platform track that supports caching")));
    const old=this.jobs.get(id);if(old){if(mode==='download')old.mode='download';this.emit();return old.promise;}
    if(this.jobs.size>=this.limits.queue)return Promise.reject(new Error(tr("Download queue is full. Wait or cancel other tasks")));
    let accept,reject;const promise=new Promise((a,b)=>{accept=a;reject=b;});
    const job={id,title,mode:mode==='automatic'?'automatic':'download',status:'queued',done:0,total:0,error:'',warning:'',promise,accept,reject,abort:new AbortController(),revision:this.revision};
    this.history=this.history.filter(row=>row.id!==id);this.jobs.set(id,job);this.emit();queueMicrotask(()=>this.pump());return promise;
  }
  cancel(id){const job=this.jobs.get(id);if(!job)return;job.abort.abort(cancelled());if(job!==this.active)this.finish(job,cancelled());}
  cancelAutomatic(except=''){for(const job of [...this.jobs.values()])if(job.mode==='automatic' && job.id!==except)this.cancel(job.id);}
  async clear(){++this.revision;const waiting=[];for(const job of [...this.jobs.values()]){waiting.push(job.promise.catch(()=>{}));this.cancel(job.id);}await Promise.all(waiting);}
  finish(job,error,result){
    if(this.jobs.get(job.id)!==job)return;
    this.jobs.delete(job.id);job.status=error?(error.name==='AbortError'?'cancelled':'error'):'complete';job.error=error?.name==='AbortError'?'':error?.name==='QuotaExceededError'?tr("Browser storage is full. Clear cache or export a backup first"):error?.message || '';
    this.history.unshift({...job,promise:undefined,accept:undefined,reject:undefined,abort:undefined,source:undefined});this.history.length=Math.min(this.history.length,this.limits.history);
    if(error)job.reject(error);else job.accept(result);this.emit();
  }
  async pump(){
    if(this.active)return;const job=[...this.jobs.values()].find(row=>row.mode==='download') || this.jobs.values().next().value;if(!job)return;
    this.active=job;let timer;
    try{
      job.abort.signal.throwIfAborted();timer=this.setTimer(()=>job.abort.abort(new Error(tr("Download timed out. Try again later"))),this.limits.timeoutMs);
      job.status='preparing';this.emit();const record=await this.ensure(job.id,job.abort.signal);job.abort.signal.throwIfAborted();job.title=record.title;
      if(cacheKind(record) && job.mode==='automatic'){this.finish(job,null,{alreadyCached:true});return;}
      let blob=null;
      if(!cacheKind(record)){
        const source=await this.resolve(job.id,job.abort.signal);job.source=source?.url;job.abort.signal.throwIfAborted();
        if(typeof source?.url!=='string' || !/^\/api\/media\/[a-f0-9]{48}$/.test(source.url))throw new Error(tr("The platform did not provide a downloadable audio source"));
        const estimate=await this.estimate().catch(()=>({}));job.abort.signal.throwIfAborted();
        const reserve=estimate.quota>0?Math.min(64*1048576,estimate.quota*.02):0;
        const available=estimate.quota>0?Math.max(0,estimate.quota-(estimate.usage || 0)-reserve):Infinity;
        const response=await this.fetcher(source.url,{signal:job.abort.signal,credentials:'same-origin',cache:'no-store'});
        const total=Number(response.headers.get('content-length')) || 0,type=(response.headers.get('content-type') || source.type || '').split(';')[0];
        if(response.status!==200 || !response.body || !/^(?:audio\/[a-z0-9.+-]+|application\/(?:octet-stream|ogg)|video\/mp4)$/i.test(type)){await response.body?.cancel().catch(()=>{});throw new Error(tr("Download did not return complete audio. Retry or choose another source"));}
        const limit=Math.min(this.limits.fileBytes,available);if(total>limit){await response.body.cancel().catch(()=>{});throw new Error(total>this.limits.fileBytes?tr("A download cannot exceed 512 MB"):tr("Browser storage is full. Clear cache first"));}
        job.status='downloading';job.total=total;this.emit();let last=0;
        const reader=response.body.getReader();
        const measured=new ReadableStream({
          pull:async controller=>{try{job.abort.signal.throwIfAborted();const next=await reader.read();job.abort.signal.throwIfAborted();if(next.done){controller.close();return;}
            job.done+=next.value.byteLength;if(job.done>limit)throw new Error(tr("Download exceeds the file limit or remaining browser storage"));
            if(this.now()-last>=this.limits.progressMs){last=this.now();this.emit();}controller.enqueue(next.value);
          }catch(error){await reader.cancel(error).catch(()=>{});controller.error(error);}},
          cancel:reason=>reader.cancel(reason)
        },{highWaterMark:1});
        // The browser owns Blob buffering; JS does not retain an array of every audio chunk.
        try{blob=await new Response(measured,{headers:{'Content-Type':type}}).blob();}finally{reader.releaseLock();}
        job.abort.signal.throwIfAborted();if(!job.done || total && job.done!==total)throw new Error(tr("Music download incomplete. Download again"));
        const head=await blob.slice(0,64).arrayBuffer();if(!audioTypes.some(ext=>hasAudioHeader('audio.'+ext,head)))throw new Error(tr("Downloaded content is not a supported audio file"));
      }
      job.status='saving';this.emit();const assets=await this.assets(job.id,job.abort.signal);job.abort.signal.throwIfAborted();
      job.warning=assets.warning || '';let result=await this.save(job.id,blob,{mode:job.mode,signal:job.abort.signal,assets});
      // A completed transaction stays committed even when cancellation arrives immediately after it.
      try{this.committed(result);}catch{job.warning=tr("Audio saved, but the interface has not updated. Refresh the cache list");}
      if(job.mode==='download' && cacheKind(result.saved)==='automatic'){
        result=await this.save(job.id,null,{mode:'download',signal:job.abort.signal,assets:{}});try{this.committed(result);}catch{job.warning=tr("Audio saved, but the interface has not updated. Refresh the cache list");}
      }
      this.finish(job,null,result);
    }catch(error){this.finish(job,error);}
    finally{this.clearTimer(timer);try{if(/^\/api\/media\/[a-f0-9]{48}$/.test(job.source || ''))Promise.resolve(this.revoke(job.source)).catch(()=>{});}catch{/* Cleanup failure cannot lock the next transfer. */}this.active=null;queueMicrotask(()=>this.pump());}
  }
}

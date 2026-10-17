import {tr} from './i18n.mjs';
import {LibraryStore} from './storage.mjs';
import {CacheStore} from './cache-storage.mjs';
import {cacheKind} from './cache-policy.mjs';
import {downloadAudio} from './download-response.mjs';
import {requestPlatformJson} from './platform-request.mjs';
import {showDownloadNotification} from './web-integration.mjs';

const KEY='backgroundDownloads',active=row=>['queued','preparing','downloading','saving'].includes(row.status);
export const backgroundJobId=id=>typeof id==='string' && /^(?:qq|bili|netease)-[A-Za-z0-9_-]{1,190}$/.test(id);
const publicRow=({assets,path,bgId,notify,workerOnly,...row})=>({...row,mode:'download',progress:row.total>0?Math.min(1,row.done/row.total):0});
/** Persistent metadata only. Media is atomically committed to the normal library, never the app cache. */
export class BackgroundDownloads {
  constructor({store,registration,clients,request=requestPlatformJson,fetcher=globalThis.fetch?.bind(globalThis),now=Date.now,notify=showDownloadNotification,locks=globalThis.navigator?.locks}={}) {
    Object.assign(this,{store,registration,clients,request,fetcher,now,notify,locks});this.cache=new CacheStore(store);this.serial=Promise.resolve();this.controllers=new Map();this.launches=new Map();this.running=null;
  }
  async rows(){return await this.store.read('settings',KEY) || [];}
  mutate(fn){const operation=this.serial.catch(()=>{}).then(async()=>{let result,failure;try{await this.store.write(['settings'],tx=>{const store=tx.objectStore('settings'),r=store.get(KEY);r.onsuccess=()=>{try{const rows=r.result || [];result=fn(rows);store.put(rows,KEY);}catch(error){failure=error;tx.abort();}};});}catch(error){throw failure || error;}return result;});this.serial=operation;return operation;}
  async publish(){const rows=(await this.rows()).map(publicRow);this.progressClients=await this.clients.matchAll({type:'window',includeUncontrolled:true});for(const client of this.progressClients)try{client.postMessage({type:'tinglan-downloads',rows});}catch{}return rows;}
  async avoidNative(){await this.store.write(['settings'],tx=>tx.objectStore('settings').put(this.now()+600000,'backgroundNativeRetryAt'));}
  async enqueue(input){
    if(!backgroundJobId(input.id))throw new Error(tr("Choose a platform track that supports caching"));
    const record=await this.store.read('tracks',input.id);if(!record)throw new Error(tr("Track is not saved in the library"));
    const assets={};if(typeof input.assets?.lyrics?.text==='string' && input.assets.lyrics.text.length<=200000)assets.lyrics=input.assets.lyrics;
    if(input.assets?.artwork?.length===2 && input.assets.artwork.every(b=>b instanceof Blob && b.size<=4*1048576))assets.artwork=input.assets.artwork;
    const job=await this.mutate(rows=>{const old=rows.find(r=>r.id===input.id && active(r));if(old)return old;if(rows.filter(active).length>=20)throw new Error(tr("Download queue is full"));
      const next={id:input.id,token:crypto.randomUUID(),title:record.title,status:'queued',done:0,total:0,error:'',warning:'',at:this.now(),assets,notify:input.notify===true};
      rows.splice(0,rows.length,...rows.filter(r=>r.id!==input.id));rows.push(next);while(rows.filter(r=>!active(r)).length>20){const at=rows.findIndex(r=>!active(r));rows.splice(at,1);}return next;
    });await this.publish();return publicRow(job);
  }
  async update(job,patch){return this.mutate(rows=>{const row=rows.find(r=>r.id===job.id && r.token===job.token);if(!row || !active(row))return false;Object.assign(row,patch);return true;});}
  async cancel(id='',token=''){
    const rows=await this.mutate(rows=>{const selected=rows.filter(r=>active(r) && (!id || r.id===id) && (!token || r.token===token)).map(r=>({...r}));for(const r of rows)if(selected.some(s=>s.token===r.token)){r.status='cancelled';delete r.assets;delete r.path;}return selected;});
    for(const row of rows){this.controllers.get(row.token)?.abort();this.launches.get(row.token)?.(false);if(row.bgId)await (await this.registration.backgroundFetch?.get(row.bgId))?.abort();if(row.path)await this.revoke(row.path);}
    await this.publish();
  }
  revoke(path){return /^\/api\/media\/[a-f0-9]{48}$/.test(path || '')?this.request('/api/cache-revoke',{method:'POST',body:{path},timeoutMs:3000}).catch(()=>{}):Promise.resolve();}
  async terminal(job,status,error=''){
    const updated=await this.update(job,{status,error,...(status==='complete'?{warning:job.assets?.warning || ''}:{}),assets:undefined,path:undefined,bgId:undefined});await this.revoke(job.path);await this.publish();
    if(updated && status!=='cancelled')await this.notify(this.registration,{title:job.title,success:status==='complete',language:(await this.store.read('settings','preferences'))?.language || 'en'},job.notify && await this.store.read('settings','systemNotifications')!==false).catch(()=>{});
  }
  async save(job,response){
    const current=(await this.rows()).find(r=>r.token===job.token);if(!current || current.status==='cancelled'){await response?.body?.cancel();return;}
    const controller=new AbortController();this.controllers.set(job.token,controller);const deadline=setTimeout(()=>controller.abort(new Error(tr("Saving download timed out. Retry"))),120000);
    try {
      let last=-Infinity,persisted=-Infinity;const estimate=await globalThis.navigator?.storage?.estimate?.().catch(()=>({})) || {};
      const limit=estimate.quota>0?Math.min(512*1048576,Math.max(0,estimate.quota-(estimate.usage || 0)-8*1048576)):512*1048576;
      const blob=response?await downloadAudio(response,{signal:controller.signal,limit,progress:(done,total)=>{
        const at=this.now();if(at-last<250)return;last=at;
        for(const c of this.progressClients || [])try{c.postMessage({type:'tinglan-download-progress',id:job.id,token:job.token,done,total});}catch{}
        // At most one small metadata transaction per second, never bytes in UI messages.
        if(at-persisted>=1000){persisted=at;this.update(job,{done,total}).catch(()=>{});}
      }}):null;
      controller.signal.throwIfAborted();const size=blob?.size || (await this.store.read('tracks',job.id))?.size || 0;if(!await this.update(job,{status:'saving',done:size,total:size}))return;
      await this.cache.save(job.id,blob,{mode:'download',assets:job.assets || {},signal:controller.signal});await this.terminal(job,'complete');
    }catch(error){await this.terminal(job,'error',controller.signal.reason?.message || error.message || tr("Unable to save cache. Retry"));}
    finally{clearTimeout(deadline);if(this.controllers.get(job.token)===controller)this.controllers.delete(job.token);}
  }
  run(){
    if(this.running){this.again=true;return this.running;}
    const operation=async()=>{do{this.again=false;await this.pump();}while(this.again);};this.running=(this.locks?this.locks.request('tinglan-background-downloads',operation):operation()).finally(()=>{this.running=null;});return this.running;
  }
  started(token,ok){this.launches.get(token)?.(ok===true);}
  async fallback(token){
    if(this.recovering)return this.recovering;
    this.recovering=(async()=>{
      const job=(await this.rows()).find(r=>r.token===token && r.status==='downloading' && r.bgId);
      if(!job || this.now()-(job.startedAt ?? job.at)<30000)return;
      const native=await this.registration.backgroundFetch?.get(job.bgId);
      if(!native || native.downloaded>0 || native.result)return;
      // Detach before abort: its delayed abort event must not cancel the replacement.
      if(!await this.update(job,{bgId:undefined,workerOnly:true,status:'preparing'}))return;
      try{await native.abort();await this.avoidNative();await this.revoke(job.path);await this.update(job,{status:'queued',path:undefined,done:0,total:0,warning:tr("Background transfer did not start. Using compatibility mode; keep this page open")});}
      catch{await this.terminal(job,'error',tr("Unable to stop background task. Retry"));}
      await this.publish();
    })().finally(()=>{this.recovering=null;});return this.recovering;
  }
  async launch(job,total){
    // BackgroundFetchManager.fetch is Window-only. The worker retains ownership
    // of the queue, completion events and IndexedDB transaction.
    const clients=await this.clients.matchAll({type:'window'}),client=clients.find(c=>c.visibilityState==='visible') || clients[0];if(!client)return false;
    const accepted=await new Promise(resolve=>{let timer;const finish=value=>{clearTimeout(timer);this.launches.delete(job.token);resolve(value);};this.launches.set(job.token,finish);timer=setTimeout(()=>finish(false),30000);
      try{client.postMessage({type:'tinglan-background-start',id:job.id,token:job.token,bgId:job.bgId,path:job.path,title:job.title,total});}catch{finish(false);}
    });
    return accepted || !!await this.registration.backgroundFetch.get(job.bgId);
  }
  async pump(){
    await this.recovering;
    this.progressClients=await this.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const row of await this.rows())if(active(row) && row.status!=='queued'){
      if(row.bgId && await this.registration.backgroundFetch?.get(row.bgId))return;
      await this.terminal(row,'error',tr("Background task interrupted. Tap Retry"));
    }
    for(;;){
      const job=(await this.rows()).find(r=>r.status==='queued');if(!job)return;
      await this.update(job,{status:'preparing'});await this.publish();
      const controller=new AbortController();this.controllers.set(job.token,controller);let deadline=setTimeout(()=>controller.abort(new Error(tr("Resolving download timed out. Retry"))),20000);
      try {
        const track=await this.store.read('tracks',job.id);if(!track)throw new Error(tr("Track removed"));
        const cached=cacheKind(track)?await this.store.read('media',job.id):null;
        if(cached instanceof Blob && cached.size>0 && cached.size===track.size){await this.save(job,null);continue;}
        const source=await this.request('/api/cache-stream?id='+encodeURIComponent(job.id),{signal:controller.signal});
        if(!/^\/api\/media\/[a-f0-9]{48}$/.test(source.url || ''))throw new Error(tr("The platform did not provide downloadable music"));job.path=source.url;
        controller.signal.throwIfAborted();
        if(this.registration.backgroundFetch && !job.workerOnly && this.now()>=(await this.store.read('settings','backgroundNativeRetryAt') || 0)){
          const head=await this.fetcher(source.url,{method:'HEAD',credentials:'same-origin',signal:controller.signal});
          if(!head.ok)throw new Error(tr("Download source temporarily unavailable"));const size=Number(head.headers.get('content-length')) || 0;if(size>512*1048576)throw new Error(tr("A track cannot exceed 512 MB"));
          clearTimeout(deadline);deadline=null;
          const bgId='tinglan-'+job.token;job.bgId=bgId;if(!await this.update(job,{status:'downloading',bgId,path:job.path,total:size,startedAt:this.now()}))continue;
          controller.signal.throwIfAborted();const started=await this.launch(job,size);
          if(controller.signal.aborted){await (await this.registration.backgroundFetch.get(bgId))?.abort();controller.signal.throwIfAborted();}
          if(started){await this.publish();return;}
          job.bgId=undefined;await this.avoidNative();await this.update(job,{bgId:undefined});
        }
        clearTimeout(deadline);await this.update(job,{status:'downloading',path:job.path,warning:tr("Compatibility download · Keep this page open until finished")});await this.publish();deadline=setTimeout(()=>controller.abort(new Error(tr("Download timed out. Retry"))),120000);
        const response=await this.fetcher(source.url,{credentials:'same-origin',cache:'no-store',signal:controller.signal});await this.save(job,response);
      }catch(error){await this.terminal(job,'error',controller.signal.reason?.message || error.message || tr("Background download failed. Retry"));}
      finally{clearTimeout(deadline);if(controller.signal.aborted)await this.revoke(job.path);if(this.controllers.get(job.token)===controller)this.controllers.delete(job.token);}
    }
  }
  async complete(event){
    const job=(await this.rows()).find(r=>r.bgId===event.registration.id);
    if(!job || job.status==='cancelled')return;
    if(event.type==='backgroundfetchsuccess'){
      try{const record=await event.registration.match(new URL(job.path,self.location.href));if(!record)throw new Error(tr("Background download is missing its audio file"));const response=await record.responseReady;
        // Embedded browsers can expose Background Fetch but return an unreadable
        // (opaque/empty) completion response. Retry once through the worker's GET.
        if(!response?.body){await this.avoidNative();await this.revoke(job.path);await this.update(job,{status:'queued',workerOnly:true,bgId:undefined,path:undefined,done:0,total:0});await this.publish();}
        else await this.save(job,response);
      }
      catch(error){await this.terminal(job,'error',error.message || tr("Unable to save cache"));}
    }else await this.terminal(job,event.type==='backgroundfetchabort'?'cancelled':'error',event.type==='backgroundfetchabort'?'':tr("Background download incomplete. Retry"));
    await this.run();
  }
}
let instance;
export async function backgroundDownloads(){if(!instance)instance=(async()=>{const store=new LibraryStore();await store.open();return new BackgroundDownloads({store,registration:self.registration,clients:self.clients});})();return instance;}

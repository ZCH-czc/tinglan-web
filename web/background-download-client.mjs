/** Page-side preparation is small; transfer and atomic persistence belong to the service worker. */
export class BackgroundDownloadClient {
  constructor({container=globalThis.navigator?.serviceWorker,ensure,assets,changed=()=>{},committed=()=>{},notify=()=>false}={}) {
    Object.assign(this,{container,ensure,assets,changed,committed,notify});this.jobs=new Map();this.native=new Map();this.rows=[];this.supported=false;
    this.listener=event=>{const data=event.data;if(data?.type==='tinglan-background-start' && event.source===container.controller){this.launch(data).catch(()=>{});}else if(data?.type==='tinglan-downloads')this.accept(data.rows);else if(data?.type==='tinglan-download-progress')this.progress(data.id,data.token,data.done,data.total);};
    container?.addEventListener('message',this.listener);
  }
  call(action,value={},timeout=4000){
    const controller=this.container?.controller;if(!controller)return Promise.reject(new Error('Background downloads are not ready'));
    return new Promise((resolve,reject)=>{const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(new Error('Background download service did not respond. Retry'));},timeout);
      channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();const data=event.data;if(data?.error)reject(new Error(data.error));else resolve(data);};
      controller.postMessage({type:'tinglan-download-command',action,...value},[channel.port2]);
    });
  }
  async start(){try{const result=await this.call('status',{},1800);this.supported=result?.protocol===1;this.accept(result.rows || []);}catch{this.supported=false;}return this.supported;}
  publish(){const preparing=[...this.jobs].filter(([,job])=>!job.token).map(([id,job])=>({id,title:job.title || 'Preparing download…',status:'preparing',mode:'download',done:0,total:0}));this.changed([...preparing,...this.rows.filter(row=>!preparing.some(job=>job.id===row.id))]);}
  progress(id,token,done,total){const row=this.rows.find(r=>r.id===id && r.token===token);if(row){Object.assign(row,{done,total,progress:total?Math.min(1,done/total):0});this.publish();}}
  async watch(row,registration){
    if(this.native.has(row.token))return;this.native.set(row.token,null);
    const item=await registration.backgroundFetch?.get('tinglan-'+row.token);if(!this.native.has(row.token))return;if(!item){this.native.delete(row.token);return;}
    const changed=()=>this.progress(row.id,row.token,item.downloaded,item.downloadTotal);
    const check=()=>{const value=this.native.get(row.token);if(!value || item.downloaded>0 || item.result)return;if(globalThis.navigator?.onLine===false || globalThis.document?.visibilityState==='hidden'){value.timer=setTimeout(check,30000);return;}this.call('fallback',{token:row.token}).catch(()=>{});};
    item.addEventListener('progress',changed);this.native.set(row.token,{item,changed,timer:setTimeout(check,30000)});changed();
  }
  async launch(job){
    if(!/^\/api\/media\/[a-f0-9]{48}$/.test(job.path || '') || job.bgId!=='tinglan-'+job.token)return;
    let ok=false;
    try {const registration=await this.container.ready,manager=registration.backgroundFetch;if(!manager)throw new Error('unavailable');
      const previous=await manager.get(job.bgId);if(!previous)await manager.fetch(job.bgId,[new Request(new URL(job.path,globalThis.location.href),{credentials:'same-origin',cache:'no-store'})],{title:String(job.title).slice(0,80),...(job.total>0?{downloadTotal:job.total}:{}),icons:[{src:'./icon-192.png',sizes:'192x192',type:'image/png'}]});ok=true;await this.watch(job,registration);
    }catch{/* Worker fallback keeps the failure recoverable on browsers without native background transfers. */}
    await this.call('started',{token:job.token,ok});
  }
  accept(rows){
    if(!Array.isArray(rows))return;const completed=rows.some(row=>row.status==='complete' && !this.rows.some(old=>old.token===row.token && old.status==='complete'));this.rows=rows.slice(0,40);this.publish();if(completed)this.committed();
    for(const [token,value] of this.native)if(!rows.some(row=>row.token===token && row.status==='downloading')){clearTimeout(value?.timer);value?.item.removeEventListener('progress',value.changed);this.native.delete(token);}
    if(this.container?.ready)this.container.ready.then(registration=>Promise.all(rows.filter(row=>row.status==='downloading').map(row=>this.watch(row,registration)))).catch(()=>{});
    for(const [id,job] of this.jobs){const row=job.token && this.rows.find(r=>r.id===id && r.token===job.token);if(!row || !['complete','error','cancelled'].includes(row.status))continue;
      this.jobs.delete(id);if(row.status==='complete')job.resolve(row);else job.reject(row.status==='cancelled'?new DOMException('Cache task cancelled','AbortError'):new Error(row.error || 'Download failed. Retry'));
    }
  }
  enqueue(id){
    const old=this.jobs.get(id);if(old)return old.promise;
    if(this.jobs.size>=20)return Promise.reject(new Error('Preparation queue is full. Wait for current tasks to finish'));
    let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});const abort=new AbortController();const job={promise,resolve,reject,abort};this.jobs.set(id,job);this.publish();
    this.preparation=(this.preparation || Promise.resolve()).then(async()=>{try{abort.signal.throwIfAborted();const track=await this.ensure(id);job.title=track?.title;abort.signal.throwIfAborted();this.publish();const assets=await this.assets(id,abort.signal);abort.signal.throwIfAborted();const reply=await this.call('enqueue',{id,assets,notify:this.notify()});job.token=reply.job?.token;if(abort.signal.aborted){await this.call('cancel',{id,token:job.token});return;}this.accept(reply.rows || []);}catch(error){if(this.jobs.get(id)===job){this.jobs.delete(id);this.publish();reject(error);}}});
    return promise;
  }
  async cancel(id='') {for(const [key,job] of this.jobs)if(!id || key===id){job.abort.abort();this.jobs.delete(key);job.reject(new DOMException('Cache task cancelled','AbortError'));}this.publish();if(this.supported){const result=await this.call('cancel',{id});this.accept(result.rows || []);}}
  async clear(){await this.cancel();}
  detach(){this.container?.removeEventListener('message',this.listener);for(const value of this.native.values()){clearTimeout(value?.timer);value?.item.removeEventListener('progress',value.changed);}this.native.clear();}
}

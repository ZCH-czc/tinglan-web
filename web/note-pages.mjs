import {hostSetTimeout,hostClearTimeout} from './host-api.mjs';
import {NOTE_LIMITS,noteFilter,normalizeNote} from './note-data.mjs';

const key=request=>JSON.stringify(request);
const blank=request=>({request,items:[],categories:[],count:0,page:request?.page || 0,pages:1,loading:false,warning:''});
function pageResult(value,request) {
  if(!value || !Array.isArray(value.items) || value.items.length>NOTE_LIMITS.pageSize || !Array.isArray(value.categories) || value.categories.length>NOTE_LIMITS.notes || value.categories.some(category=>typeof category!=='string' || !category || category.length>32) || new Set(value.categories).size!==value.categories.length || !Number.isSafeInteger(value.count) || value.count<0 || value.count>NOTE_LIMITS.notes || value.pages!==Math.max(1,Math.ceil(value.count/NOTE_LIMITS.pageSize)) || value.page!==Math.min(request.page,value.pages-1) || value.items.length>value.count)throw new Error('Invalid notes page. Refresh and retry');
  return {...value,items:value.items.map(normalizeNote)};
}
/** Accepted pages are reused until a local commit, explicit refresh or another tab's change. */
export class NotePages {
  constructor(load,changed,{limit=8}={}) {Object.assign(this,{load,changed,limit});this.cache=new Map();this.revision=0;this.current=null;this.categories=[];}
  async select(value,{force=false}={}) {
    const request=noteFilter(value),id=key(request);
    if(this.current && key(this.current.request)===id && !this.abort?.signal.aborted){if(this.current.loading && this.work)return this.work;if(!force)return;}
    this.cancel();const revision=this.revision;this.abort=new AbortController();const signal=this.abort.signal,cached=this.cache.get(id) || (this.current && key(this.current.request)===id?this.current:null);
    if(this.cache.has(id) && !force){this.current={...cached,loading:false};this.changed(this.current);return;}
    this.current={...blank(request),categories:this.categories,...cached,request,loading:true,warning:''};this.changed(this.current);
    const work=(async()=>{
      try {
        const result=pageResult(await this.load(request,{signal}),request);signal.throwIfAborted();if(revision!==this.revision)return;
        this.categories=JSON.stringify(result.categories)===JSON.stringify(this.categories)?this.categories:result.categories;
        const owned={...request,page:result.page},page={...result,categories:this.categories,request:owned,loading:false,warning:''};this.cache.delete(key(owned));this.cache.set(key(owned),page);while(this.cache.size>this.limit)this.cache.delete(this.cache.keys().next().value);this.current=page;this.changed(page);
      }catch(error){if(revision!==this.revision || signal.aborted || error.name==='AbortError')return;this.current={...this.current,loading:false,warning:error.message || 'Unable to read notes'};this.changed(this.current);}
      finally{if(revision===this.revision)this.work=null;}
    })();this.work=work;return work;
  }
  forRequest(value) {const request=noteFilter(value);return this.current && key(request)===key(this.current.request)?this.current:{...blank(request),categories:this.categories};}
  cancel(){++this.revision;this.abort?.abort();this.work=null;}
  invalidate(){this.cancel();this.cache.clear();}
}

const closed=()=>({token:'',songId:'',title:'',artists:'',content:'',category:'Thoughts',loaded:false,loading:false,busy:false,exists:false,error:'',conflict:false});
/** One editor owner and optimistic database revision prevent late saves or cross-tab overwrites. */
export class NoteEditor {
  constructor(store,changed,{committed=()=>{},now=Date.now}={}) {Object.assign(this,{store,changed,committed,now});this.state=closed();this.epoch=0;}
  patch(value){this.state={...this.state,...value};this.changed(this.state);}
  owns(ctx){return ctx.epoch===this.epoch && !ctx.signal.aborted;}
  async open(songId,song) {
    this.close();const ctx={epoch:this.epoch,signal:this.controller.signal},token=crypto.randomUUID();this.patch({token,songId,title:song?.title || '',artists:song?.artist || '',loading:true});
    try{const note=await this.store.read(songId);if(!this.owns(ctx))return;this.original=note;if(!note && !song)throw new Error('This track’s note no longer exists');this.patch({loaded:true,loading:false,exists:!!note,title:(song?.title ?? note?.title ?? '').slice(0,NOTE_LIMITS.title),artists:(song?.artist ?? note?.artists ?? '').slice(0,NOTE_LIMITS.artists),content:note?.content || '',category:note?.category || 'Thoughts'});}
    catch(error){if(this.owns(ctx))this.patch({loading:false,error:error.message || 'Unable to read note'});}
  }
  async save(input) {
    if(!this.state.loaded || input?.token!==this.state.token)return false;if(this.state.busy)return this.work;
    const ctx={epoch:this.epoch,signal:this.controller.signal},current=this.state;
    const work=(async()=>{
      this.patch({busy:true,error:'',conflict:false});
      try {
        const at=Math.max(this.now(),(this.original?.updatedAt || 0)+1),note=normalizeNote({songId:current.songId,title:current.title,artists:current.artists,content:input.content,category:input.category,createdAt:this.original?.createdAt ?? at,updatedAt:at});
        await this.store.save(note,{expectedRevision:this.original?.revision || '',signal:ctx.signal});this.notifyCommitted(note);
        if(this.owns(ctx))return true;return false;
      }catch(error){if(this.owns(ctx))this.patch({busy:false,error:error.message || 'Unable to save. Retry',conflict:error.code==='note-conflict'});return false;}
      finally{if(this.owns(ctx)){this.work=null;this.patch({busy:false});}}
    })();this.work=work;return work;
  }
  async remove(token) {
    if(token!==this.state.token || !this.state.exists || !this.state.loaded)return false;if(this.state.busy)return this.work;
    const ctx={epoch:this.epoch,signal:this.controller.signal},note=this.original;
    const work=(async()=>{this.patch({busy:true,error:'',conflict:false});try{await this.store.remove(note.songId,{expectedRevision:note.revision,signal:ctx.signal});this.notifyCommitted(null);return this.owns(ctx);}catch(error){if(this.owns(ctx))this.patch({error:error.message || 'Unable to delete',conflict:error.code==='note-conflict'});return false;}finally{if(this.owns(ctx)){this.work=null;this.patch({busy:false});}}})();this.work=work;return work;
  }
  notifyCommitted(note){try{Promise.resolve(this.committed(note)).catch(()=>{});}catch{/* A refresh failure cannot change the committed write's outcome. */}}
  close(){++this.epoch;this.controller?.abort();this.controller=new AbortController();this.work=null;this.original=null;this.state=closed();this.changed(this.state);}
}

/** Broadcast only an invalidation marker; bursts coalesce and unsupported browsers use refresh. */
export class NoteChanges {
  constructor(changed,{factory=name=>new BroadcastChannel(name),schedule=hostSetTimeout,cancel=hostClearTimeout}={}) {Object.assign(this,{changed,factory,schedule,cancel});}
  open() {
    if(this.channel)return;
    try{const channel=this.factory('tinglan-web-note-changes');this.channel=channel;channel.onmessage=event=>{if(event.data?.kind!=='notes-changed' || this.channel!==channel)return;this.cancel(this.timer);this.timer=this.schedule(()=>{this.timer=null;if(this.channel===channel)Promise.resolve(this.changed()).catch(()=>{});},120);};}catch{/* No channel permission or support: explicit refresh remains available. */}
  }
  notify(){try{this.channel?.postMessage({kind:'notes-changed'});}catch{/* A successful local write does not depend on another tab. */}}
  close(){this.cancel(this.timer);this.timer=null;const channel=this.channel;this.channel=null;try{channel?.close();}catch{}}
}

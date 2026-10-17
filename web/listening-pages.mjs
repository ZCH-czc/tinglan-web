import {tr} from './i18n.mjs';
import {listeningFilter,listeningBounds} from './listening-data.mjs';

/** Statistics are computed in a lazy worker and retained by exact calendar range. */
export class ListeningPages {
  constructor(store,worker,changed=()=>{},now=()=>Date.now()){Object.assign(this,{store,worker,changed,now});this.cache=new Map();this.revision=0;this.token=0;this.state={loading:false,warning:'',report:null};}
  async select(filter,{force=false}={}) {
    const request=listeningFilter(filter),now=this.now(),bounds=listeningBounds(request,now),key=`${request.period}|${bounds.start}|${request.period==='all'?new Date(now).toDateString():bounds.end}|${this.revision}`;
    if(!force && this.key===key && this.state.loading)return;
    if(!force && this.cache.has(key)){this.cancel();this.key=key;this.state={loading:false,warning:'',report:this.cache.get(key)};this.changed(this.state);return;}
    this.cancel();this.key=key;const token=++this.token,controller=this.controller=new AbortController();this.state={loading:true,warning:'',report:this.cache.get(key) || null};this.changed(this.state);
    try{const records=await this.store.read(bounds,{signal:controller.signal});if(token!==this.token)return;const report=await this.worker.run('report',{records,filter:request,now});if(token!==this.token)return;this.cache.set(key,report);while(this.cache.size>4)this.cache.delete(this.cache.keys().next().value);this.state={loading:false,warning:'',report};this.changed(this.state);}catch(error){if(token!==this.token)return;this.state={...this.state,loading:false,warning:error.message || tr("Unable to read listening report")};this.changed(this.state);}
  }
  cancel(){++this.token;this.controller?.abort();this.controller=null;this.worker.close();this.key='';}
  invalidate(){this.cancel();++this.revision;this.cache.clear();this.state={loading:false,warning:'',report:null};}
}

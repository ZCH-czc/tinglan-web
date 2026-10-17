/** Retained feeds append immutable snapshots. Cursor cycles and duplicate-only pages stop pagination. */
export class ActivityFeed {
  constructor(load,changed,{limit=8,maxItems=300}={}) {Object.assign(this,{load,changed,limit,maxItems});this.cache=new Map();this.revision=0;this.current=null;}
  async select(request,{force=false}={}) {
    this.cancel();const revision=this.revision,owned={...request},key=JSON.stringify(owned),cached=this.cache.get(key);
    this.abort=new AbortController();
    if(cached && !force){this.cache.delete(key);this.cache.set(key,cached);this.current={...cached,request:owned,loading:false};this.changed(this.current);return;}
    this.current={items:[],next:'',notice:'',seen:[],...cached,request:owned,loading:true,warning:''};this.changed(this.current);
    await this.requestPage(owned,'',{force,revision,key,append:false});
  }
  async more() {
    if(!this.current?.next || this.current.loading)return;
    const revision=++this.revision,key=JSON.stringify(this.current.request),cursor=this.current.next;
    this.abort?.abort();this.abort=new AbortController();this.current={...this.current,loading:true,warning:''};this.changed(this.current);
    await this.requestPage(this.current.request,cursor,{revision,key,append:true,force:false});
  }
  async requestPage(request,cursor,{revision,key,append,force}) {
    try {
      const value=await this.load({...request,cursor},{force,signal:this.abort.signal});if(revision!==this.revision)return;
      if(!Array.isArray(value.items))throw new Error('The platform did not return a valid list');
      const previous=append?this.current.items:[],before=new Set(previous.map(row=>row.id));
      const merged=[...new Map([...previous,...value.items].map(row=>[row.id,row])).values()];
      const added=value.items.some(row=>!before.has(row.id)),seen=append?[...this.current.seen,cursor]:[''];
      const next=typeof value.next==='string'?value.next:'';
      const cyclic=next && seen.includes(next),duplicate=append && !added,limited=merged.length>=this.maxItems;
      const result={request:{...request},items:merged.slice(0,this.maxItems),total:Number.isSafeInteger(value.total) && value.total>=0?value.total:0,next:cyclic || duplicate || limited?'':next,seen,notice:limited?`Showing the latest ${this.maxItems} items; refresh for new content`:cyclic || duplicate?'The platform repeated a page. Further loading stopped':value.notice || '',warning:value.warning || ''};
      this.cache.delete(key);this.cache.set(key,result);while(this.cache.size>this.limit)this.cache.delete(this.cache.keys().next().value);
      this.current={...result,loading:false};this.changed(this.current);
    }catch(error){if(revision!==this.revision || error.name==='AbortError')return;this.current={...this.current,loading:false,warning:error.message || 'Post temporarily unavailable'};this.changed(this.current);}
  }
  retainedSongs(){return [...new Map([...this.cache.values()].flatMap(value=>value.items.flatMap(row=>[row.song,row.original?.song])).filter(Boolean).map(song=>[song.id,song])).values()];}
  cancel(){++this.revision;this.abort?.abort();}
  clear(){this.cancel();this.cache.clear();this.current=null;}
}

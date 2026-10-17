/** Small retained pages with request ownership; page switches never refresh accepted results. */
export class CreatorPages {
  constructor(load,changed) {Object.assign(this,{load,changed});this.cache=new Map();this.revision=0;this.current=null;}
  async select(source,id,page=1,{force=false,profileOnly=false}={}) {
    const revision=++this.revision;this.abort?.abort();this.abort=new AbortController();
    const key=`${source}|${id}|${page}${profileOnly?'|profile':''}`,cached=this.cache.get(key);
    if(cached && !force){this.cache.delete(key);this.cache.set(key,cached);this.current={...cached,source,id,page,loading:false};this.changed(this.current);return;}
    this.current={profile:cached?.profile || {source,id,name:'',description:'',avatarUrl:'',followers:0},songs:cached?.songs || [],more:cached?.more || false,total:cached?.total || 0,warning:'',source,id,page,loading:true};this.changed(this.current);
    try {
      const value=await this.load(source,id,page,{force,profileOnly,signal:this.abort.signal});if(revision!==this.revision)return;
      this.cache.set(key,value);while(this.cache.size>12)this.cache.delete(this.cache.keys().next().value);
      this.current={...value,source,id,page,loading:false};this.changed(this.current);
    }catch(error){if(revision!==this.revision || error.name==='AbortError')return;this.current={...this.current,loading:false,warning:error.message || 'Artist page temporarily unavailable'};this.changed(this.current);}
  }
  retainedSongs(){return [...this.cache.values()].flatMap(value=>value.songs || []);}
  cancel(){++this.revision;this.abort?.abort();}
  clear(){this.cancel();this.cache.clear();this.current=null;}
}

/** Bounded retained pages. Each request has one owner; leaving cancels without discarding accepted results. */
export class ContentPages {
  constructor(load,changed,{limit=16,empty=()=>({items:[],songs:[],next:'',more:false,total:0})}={}) {Object.assign(this,{load,changed,limit,empty});this.cache=new Map();this.current=null;this.revision=0;}
  async select(request,{force=false}={}) {
    const revision=++this.revision;this.abort?.abort();this.abort=new AbortController();request={...request};
    const key=JSON.stringify(request),cached=this.cache.get(key);
    if(cached && !force){this.cache.delete(key);this.cache.set(key,cached);this.current={...cached,request,loading:false};this.changed(this.current);return;}
    this.current={...this.empty(request),...cached,request,loading:true,warning:''};this.changed(this.current);
    try {
      const value=await this.load(request,{force,signal:this.abort.signal});if(revision!==this.revision)return;
      this.cache.set(key,{...value,request});while(this.cache.size>this.limit)this.cache.delete(this.cache.keys().next().value);
      this.current={...value,request,loading:false};this.changed(this.current);
    }catch(error){if(revision!==this.revision || error.name==='AbortError')return;this.current={...this.current,loading:false,warning:error.message || 'Content temporarily unavailable'};this.changed(this.current);}
  }
  findComment(id,subject=this.current?.request?.id){const pages=[...(this.current?.request?.id===subject?[this.current]:[]),...[...this.cache.values()].reverse().filter(value=>value.request?.id===subject)];return pages.flatMap(value=>[...(value.parent?[value.parent]:[]),...(value.items || [])]).find(row=>row.id===id);}
  retainedSongs(){return [...this.cache.values()].flatMap(value=>value.songs || []);}
  cancel(){++this.revision;this.abort?.abort();}
  clear(){this.cancel();this.cache.clear();this.current=null;}
}

/** Collect every available page before committing a local playlist. Errors/cancellation leave it untouched. */
export async function collectPlaylist(load,request,{signal,progress=()=>{},limit=10000}={}) {
  const songs=new Map();let playlist=null,unavailable=0,total=0;
  for(let page=1;page<=500;page++) {
    signal?.throwIfAborted();const data=await load({...request,page},{signal});signal?.throwIfAborted();
    if(!data.playlist || data.playlist.source!==request.source || data.playlist.id!==request.id)throw new Error('Playlist content identifier mismatch');
    playlist ||= data.playlist;total=Math.max(total,data.total || 0);
    if(total>limit)throw new Error('Playlist exceeds library capacity. Choose a smaller playlist');
    const before=songs.size;
    for(const song of data.songs || [])songs.set(song.id,song);
    if(songs.size>limit)throw new Error('Playlist exceeds library capacity');
    unavailable+=Math.max(0,data.unavailable || 0);progress({page,total,received:songs.size,unavailable});
    if(!data.more)return {playlist,songs:[...songs.values()],total,unavailable:Math.max(unavailable,total-songs.size)};
    if(!(data.songs?.length || data.unavailable))throw new Error('The platform returned an empty page. Refresh and retry');
    if(data.songs?.length && songs.size===before)throw new Error('The platform repeated a page. Refresh and retry');
  }
  throw new Error('Playlist pagination exceeds supported limits');
}

import {validRoom} from './live-room.mjs';

const validAuthor=id=>typeof id==='string' && /^[1-9][0-9]{0,18}$/.test(id);
const key=request=>`${request.scope}|${request.id || ''}`;
const blank=request=>({request,known:false,liveRoomId:'',items:[],fetchedAt:0,loading:false,warning:''});
export function presenceRoute(route) {
  if(route?.page==='creator' && route.creatorSource==='bili' && validAuthor(route.creatorId))return {scope:'author',id:route.creatorId};
  if(route?.page==='following')return {scope:'following',id:''};
  return null;
}
export function validatePresence(value,request) {
  if(value?.scope!==request.scope || value.id!==request.id || typeof value.known!=='boolean' || typeof value.liveRoomId!=='string' || value.liveRoomId && !validRoom(value.liveRoomId) || !Number.isSafeInteger(value.fetchedAt) || value.fetchedAt<1 || !Array.isArray(value.items) || value.items.length>50)throw new Error('Live status does not match the current page');
  if(request.scope==='author' && value.items.length || request.scope==='following' && value.liveRoomId || !value.known && value.liveRoomId)throw new Error('Invalid live status content');
  const ids=new Set();
  for(const row of value.items) {
    if(!validAuthor(row.id) || !validRoom(row.roomId) || typeof row.name!=='string' || !row.name.trim() || row.name.length>256 || typeof row.title!=='string' || row.title.length>512 || ids.has(row.id))throw new Error('The platform returned an invalid live list');
    ids.add(row.id);
  }
  return value;
}
/** Live data stays in memory. Back navigation reuses it; refresh is always explicit. */
export class LivePresencePages {
  constructor(load,changed,{limit=12}={}) {Object.assign(this,{load,changed,limit});this.cache=new Map();this.current=null;this.revision=0;}
  async select(request,{force=false}={}) {
    if(!request){this.cancel();return;}
    const owned={...request},id=key(owned);
    if(this.current && key(this.current.request)===id && !this.abort?.signal.aborted){if(this.current.loading && this.work)return this.work;if(!force)return;}
    this.cancel();const revision=this.revision;this.abort=new AbortController();const signal=this.abort.signal,cached=this.cache.get(id);
    if(cached && !force){this.cache.delete(id);this.cache.set(id,cached);this.current={...cached,loading:false};this.changed(this.current);return;}
    this.current={...blank(owned),...cached,request:owned,loading:true,warning:''};this.changed(this.current);
    const work=(async()=>{
      try {
        const value=validatePresence(await this.load(owned,{force,signal}),owned);signal.throwIfAborted();if(revision!==this.revision)return;
        const result={...value,request:owned,loading:false,warning:''};this.cache.delete(id);this.cache.set(id,result);while(this.cache.size>this.limit)this.cache.delete(this.cache.keys().next().value);
        this.current=result;this.changed(this.current);
      }catch(error){if(revision!==this.revision || signal.aborted || error.name==='AbortError')return;this.current={...this.current,loading:false,warning:error.message || 'Live status unavailable'};this.changed(this.current);}
      finally{if(revision===this.revision)this.work=null;}
    })();this.work=work;return work;
  }
  forRoute(route) {const request=presenceRoute(route);return request && this.current && key(request)===key(this.current.request)?this.current:blank(request);}
  cancel(){++this.revision;this.abort?.abort();this.work=null;}
  clear(){this.cancel();this.cache.clear();this.current=null;this.changed(null);}
}

/* Live author protocols ported from Android BilibiliLiveRepository and BilibiliCreatorRepository. GPL-3.0. */
import {PlatformError,cleanText} from './upstream.mjs';
import {validCreator} from './creators.mjs';
import {publicImage} from './content-images.mjs';
import {validRoom} from '../web/live-room.mjs';

const invalid=()=>new PlatformError('invalid-response','The platform returned no valid live status');
const exactId=(value,valid)=>typeof value==='string' && valid(value)?value:Number.isSafeInteger(value) && value>0 && valid(String(value))?String(value):'';
const creatorId=value=>exactId(value,id=>validCreator('bili',id));
const roomId=value=>exactId(value,validRoom);

export function presenceRequest(input) {
  if(input?.scope==='following' && (input.id===undefined || input.id===''))return {scope:'following',id:''};
  if(input?.scope==='author' && typeof input.id==='string' && validCreator('bili',input.id))return {scope:'author',id:input.id};
  throw new PlatformError('invalid-request','Invalid live status page parameters',400);
}
export function mapCreatorPresence(data,expectedId) {
  if(!validCreator('bili',expectedId) || creatorId(data?.mid)!==expectedId)throw invalid();
  const live=data.live_room;
  if(!live || typeof live!=='object')return {known:false,liveRoomId:'',items:[]};
  if(![0,1,2,'0','1','2'].includes(live.liveStatus))throw invalid();
  const active=Number(live.liveStatus)===1,room=active?roomId(live.roomid):'';
  if(active && !room)throw invalid();
  return {known:true,liveRoomId:room,items:[]};
}
export function mapFollowedLive(data) {
  const rows=data?.live_users?.items;
  if(!Array.isArray(rows))throw invalid();
  const result=new Map();
  for(const row of rows.slice(0,100)) {
    const id=creatorId(row?.mid ?? row?.uid),room=roomId(row?.room_id ?? row?.roomid ?? row?.live_info?.room_id);
    const name=cleanText(row?.uname ?? row?.name,256).trim();
    if(!id || !room || !name || result.has(id))continue;
    result.set(id,{id,name,roomId:room,title:cleanText(row.title,512),avatar:publicImage('bili',row.face)});
  }
  return {known:true,liveRoomId:'',items:[...result.values()].slice(0,50)};
}
function requireOwnAccount(session) {
  const ids=String(session?.cookies?.bili || '').split(';').map(row=>row.trim()).filter(row=>row.startsWith('DedeUserID=')).map(row=>row.slice(11));
  if(ids.length!==1 || !validCreator('bili',ids[0]))throw new PlatformError('sign-in','Connect your own Bilibili account to view followed live streams',401);
}

/** Ephemeral, account-owned live status. Equivalent reads share one request; nothing polls. */
export class LivePresenceRepository {
  constructor({providers,now=Date.now,ownsSession=()=>true,limit=128,ttl=30000}) {Object.assign(this,{providers,now,ownsSession,limit,ttl});this.entries=new Map();}
  async read(session,input,{force=false}={}) {
    const request=presenceRequest(input),generation=session.generation;
    if(!this.ownsSession(session))throw new PlatformError('session-changed','Account changed. Reopen the page',409);
    if(request.scope==='following')requireOwnAccount(session);
    const key=`${session.id}|${generation}|${request.scope}|${request.id}`,old=this.entries.get(key);
    if(old?.work)return old.work;
    if(old?.value && !force && old.until>this.now())return old.value;
    if(!old && this.entries.size>=this.limit) {
      const expired=[...this.entries].find(([,entry])=>!entry.work);
      if(!expired)throw new PlatformError('busy','Too many live-status requests. Retry later',429);
      this.entries.delete(expired[0]);
    }
    const entry={session:session.id,controller:new AbortController()};this.entries.delete(key);this.entries.set(key,entry);
    const work=(async()=>{
      const options={signal:entry.controller.signal,fresh:force,ttl:this.ttl};
      const answer=request.scope==='author'
        ?await this.providers.bili('/x/space/wbi/acc/info',{mid:request.id},session,true,false,options)
        :await this.providers.bili('/x/polymer/web-dynamic/v1/portal',{up_list_more:1,web_location:'333.1365'},session,false,false,options);
      entry.controller.signal.throwIfAborted();
      if(!this.ownsSession(session) || generation!==session.generation || this.entries.get(key)!==entry)throw new PlatformError('session-changed','Account changed. Retry',409);
      const status=request.scope==='author'?mapCreatorPresence(answer?.data,request.id):mapFollowedLive(answer?.data);
      entry.value={...request,...status,fetchedAt:this.now()};entry.until=this.now()+this.ttl;return entry.value;
    })();entry.work=work;
    try{return await work;}catch(error){if(this.entries.get(key)===entry)this.entries.delete(key);if(!this.ownsSession(session) || generation!==session.generation)throw new PlatformError('session-changed','Account changed. Retry',409);throw error;}
    finally{entry.work=null;}
  }
  clear(sessionId) {for(const [key,entry] of this.entries)if(entry.session===sessionId){entry.controller.abort();this.entries.delete(key);}}
}

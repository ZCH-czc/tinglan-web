/* Video interaction protocol ported from ArchiveTune's BilibiliVideoActions.kt.
 * ArchiveTune (2026), Rukamori and contributors. GPL-3.0. */
import {randomBytes} from 'node:crypto';
import {PlatformError,cleanText} from './upstream.mjs';
import {loadBilibiliSegment,resolveBilibiliSegment} from './bilibili-segment.mjs';
import {parseBilibiliId} from '../web/bilibili-id.mjs';

const token=()=>randomBytes(16).toString('hex');
const identifier=value=>typeof value==='number'&&!Number.isSafeInteger(value)?'':/^[1-9]\d{0,18}$/.test(String(value || ''))?String(value):'';
const changed=()=>new PlatformError('session-changed','Account changed. Reopen video actions',409);
const invalid=message=>new PlatformError('invalid-request',message,400);
function credentials(session) {
  const cookie=session.cookies.bili || '',fields=new Map(cookie.split(';').map(part=>{const at=part.indexOf('=');return [part.slice(0,at).trim(),part.slice(at+1).trim()];}));
  const csrf=fields.get('bili_jct');
  if(!fields.get('SESSDATA') || !/^[a-fA-F0-9]{32}$/.test(csrf || ''))throw new PlatformError('sign-in','Sign in to Bilibili，before using likes and collections',401);
  return {cookie,csrf};
}

/** Account-owned state and an in-memory operation journal. POSTs never retry automatically. */
export class BilibiliActions {
  constructor({providers,now=Date.now,ownsSession=()=>true}) {Object.assign(this,{providers,now,ownsSession});this.states=new Map();this.operations=new Map();}
  valid(record) {return this.states.get(record.key)===record && this.ownsSession(record.session) && record.generation===record.session.generation && record.cookie===record.session.cookies.bili;}
  guard(record) {if(!this.valid(record))throw changed();record.controller.signal.throwIfAborted();}
  isMutating(id){return [...this.states.values()].some(record=>record.session.id===id && record.pending && record.pendingKind==='mutation');}
  clearSession(id) {for(const record of this.states.values())if(record.session.id===id){record.controller.abort();this.states.delete(record.key);}}
  prune() {
    for(const record of this.states.values())if(!this.valid(record) || !record.pending && record.expiresAt<=this.now()){record.controller.abort();this.states.delete(record.key);}
    for(const [key,value] of this.operations)if(!value.pending && value.expiresAt<=this.now())this.operations.delete(key);
  }
  room(map,limit) {
    if(map.size<limit)return;
    const old=[...map].find(([,value])=>!value.pending);
    if(!old)throw new PlatformError('busy','Too many video action requests. Retry later',429,3);
    old[1].controller?.abort();map.delete(old[0]);
  }
  public(record) {return {bvid:record.bvid,title:record.title,token:record.token,liked:record.liked,folders:record.folders.map(row=>({...row})),needsRefresh:record.needsRefresh || false};}
  target(session,track,revision) {
    if(revision!==session.accountRevision || !this.ownsSession(session))throw changed();
    const id=track.source==='bili' && parseBilibiliId(track.remoteId);if(!id)throw invalid('This content does not support Bilibili Video actions');
    return {id,key:`${session.id}:${session.generation}:${id.bvid}`,...credentials(session)};
  }
  async read(record,path,params) {
    this.guard(record);
    const {body}=await this.providers.net.reply('bili','https://api.bilibili.com'+path+'?'+new URLSearchParams(params),{headers:this.providers.headers('bili',record.cookie),signal:record.controller.signal},record.key);
    this.guard(record);
    if(body.code!==0)throw new PlatformError(body.code===-111?'sign-in':'unavailable',body.code===-111?'Bilibili Sign-in validation expired. Reconnect the account':'Unable to read video action status',body.code===-111?401:502);
    return body.data;
  }
  folders(rows) {
    if(rows===null || rows===undefined)return [];
    if(!Array.isArray(rows) || rows.length>500)throw new PlatformError('invalid-response','Collection list too large or invalid');
    const result=[],seen=new Set();
    for(const row of rows){const id=identifier(row?.id);if(!id || seen.has(id))throw new PlatformError('invalid-response','Invalid collection identifier');seen.add(id);result.push({id,title:cleanText(row.title,200) || 'Untitled collection',selected:Number(row.fav_state)===1,private:(Number(row.attr)&1)===1});}
    return result;
  }
  async load(record,track) {
    const {view,bvid}=await loadBilibiliSegment(this.providers,track,record.session);this.guard(record);
    const aid=identifier(view?.aid);if(!aid || bvid!==record.bvid)throw new PlatformError('invalid-response','Invalid video submission identifier');
    const nav=await this.read(record,'/x/web-interface/nav',{}),mid=identifier(nav?.mid);
    if(!nav?.isLogin || !mid)throw new PlatformError('sign-in','Bilibili Session expired. Reconnect your account',401);
    const liked=await this.read(record,'/x/web-interface/archive/has/like',{bvid});
    if(![0,1,'0','1'].includes(liked))throw new PlatformError('invalid-response','Invalid like status');
    const folders=await this.read(record,'/x/v3/fav/folder/created/list-all',{up_mid:mid,type:2,rid:aid});
    record.view={bvid,pages:view.pages.slice(0,1000).map(row=>({cid:row.cid}))};record.aid=aid;record.title=cleanText(view.title,200);record.liked=Number(liked)===1;record.folders=this.folders(folders?.list);record.loaded=true;record.needsRefresh=false;record.token=token();record.expiresAt=this.now()+300000;
    return this.public(record);
  }
  async state(session,track,{revision,force=false}={}) {
    this.prune();const target=this.target(session,track,revision);let record=this.states.get(target.key);
    if(record?.pending && record.pendingKind==='mutation')throw new PlatformError('busy','Video action is submitting. Wait for its result',409);
    if(record?.pending){await record.pending;this.guard(record);resolveBilibiliSegment(record.view,track.remoteId);return this.public(record);}
    if(record?.loaded && !force && !record.needsRefresh){resolveBilibiliSegment(record.view,track.remoteId);return this.public(record);}
    if(!record){this.room(this.states,256);record={...target,bvid:target.id.bvid,session,generation:session.generation,controller:new AbortController(),loaded:false,folders:[],expiresAt:this.now()+300000};this.states.set(target.key,record);}
    const operation=this.load(record,track);record.pending=operation;record.pendingKind='read';
    try{return await operation;}catch(error){record.loaded=false;if(!this.valid(record))throw changed();throw error;}finally{if(record.pending===operation)record.pending=null;}
  }
  async mutate(session,track,input) {
    this.prune();const target=this.target(session,track,input.revision);
    if(!/^[a-f0-9]{48}$/.test(input.operation || '') || !/^[a-f0-9]{32}$/.test(input.token || '') || !['like','favorites'].includes(input.action))throw invalid('Invalid video action request');
    if(input.action==='like' && typeof input.liked!=='boolean')throw invalid('Invalid like option');
    if(input.action==='favorites' && (!Array.isArray(input.selected) || input.selected.length>500 || input.selected.some(id=>!identifier(id) || typeof id!=='string') || new Set(input.selected).size!==input.selected.length))throw invalid('Invalid collection option');
    const signature=JSON.stringify([target.id.bvid,track.remoteId,input.token,input.action,input.liked,input.selected?.slice().sort()]),key=`${session.id}:${session.generation}:${input.operation}`,previous=this.operations.get(key);
    if(previous){if(previous.signature!==signature)throw invalid('This action identifier was used for another request');return previous.promise;}
    const record=this.states.get(target.key);
    if(!record?.loaded || record.needsRefresh || record.token!==input.token)throw new PlatformError('needs-refresh','Video action status changed. Refresh before continuing',409);
    this.guard(record);resolveBilibiliSegment(record.view,track.remoteId);
    if(record.pending)throw new PlatformError('busy','Video action is submitting. Wait for its result',409);
    const selected=new Set(input.selected || []);
    if(input.action==='favorites' && [...selected].some(id=>!record.folders.some(row=>row.id===id)))throw invalid('Choose collections belonging to this account');
    this.room(this.operations,512);
    const journal={signature,pending:true,expiresAt:this.now()+600000};this.operations.set(key,journal);
    // Begin after installing both locks, including for a duplicate request arriving in the same turn.
    const operation=Promise.resolve().then(async()=>{
      this.guard(record);
      const fields=input.action==='like'?{aid:record.aid,like:input.liked?'1':'2',csrf:record.csrf}:{rid:record.aid,type:'2',csrf:record.csrf,add_media_ids:record.folders.filter(row=>!row.selected&&selected.has(row.id)).map(row=>row.id).join(','),del_media_ids:record.folders.filter(row=>row.selected&&!selected.has(row.id)).map(row=>row.id).join(',')};
      const nothing=input.action==='like'?input.liked===record.liked:!fields.add_media_ids&&!fields.del_media_ids;
      if(!nothing){
        const path=input.action==='like'?'/x/web-interface/archive/like':'/x/v3/fav/resource/deal';
        const {body}=await this.providers.net.reply('bili','https://api.bilibili.com'+path,{method:'POST',headers:{...this.providers.headers('bili',record.cookie),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields).toString(),signal:record.controller.signal},record.key);
        this.guard(record);
        if(body.code!==0)throw new PlatformError(body.code===-111?'sign-in':'action-unconfirmed',body.code===-111?'Bilibili Sign-in validation expired. Reconnect the account':'Action not confirmed. Refresh before deciding whether to retry',body.code===-111?401:409);
        const count=body.data?.success_num;
        if(input.action==='favorites' && fields.add_media_ids && Number.isFinite(count) && count<fields.add_media_ids.split(',').length)throw new PlatformError('action-unconfirmed','Some collection actions are unconfirmed. Refresh collection status',409);
      }
      if(input.action==='like')record.liked=input.liked;else record.folders=record.folders.map(row=>({...row,selected:selected.has(row.id)}));
      record.token=token();record.expiresAt=this.now()+300000;this.providers.net.clearIdentity?.(session.id);
      return {...this.public(record),notice:nothing?'Status unchanged':input.action==='like'?(record.liked?'Liked Bilibili Videos':'Cancelled Bilibili Like'):'Updated Bilibili collections'};
    }).catch(error=>{record.needsRefresh=true;record.token=token();if(!this.valid(record))throw changed();throw error;}).finally(()=>{journal.pending=false;if(record.pending===operation)record.pending=null;});
    journal.promise=operation;record.pending=operation;record.pendingKind='mutation';return operation;
  }
}

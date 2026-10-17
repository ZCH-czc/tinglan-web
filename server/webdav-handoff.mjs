/* WebDAV playback.json protocol compatible with ArchiveTune Android.
 * ArchiveTune (2026), Rukamori and contributors. GPL-3.0. */
import {randomBytes,createHash} from 'node:crypto';
import {PlatformError} from './upstream.mjs';
import {normalizeHandoff,handoffExpired,HANDOFF_LIMITS} from '../web/playback-handoff.mjs';

const token=()=>randomBytes(16).toString('hex');
const changed=()=>new PlatformError('session-changed','Connection or account changed. Reopen playback handoff',409);
const bad=message=>new PlatformError('invalid-request',message,400);
const strongEtag=value=>typeof value==='string' && /^"[\x21\x23-\x7e\x80-\xff]{0,510}"$/.test(value)?value:null;
const safeText=(value,min,max)=>typeof value==='string' && value.length>=min && value.length<=max && !/[\r\n\u0000]/.test(value);
export function webdavConfiguration(value) {
  const deviceName=typeof value?.deviceName==='string'?value.deviceName.trim():'';
  if(!safeText(value?.endpoint,1,2048) || !safeText(value.username,0,512) || value.username.includes(':') || !safeText(value.password,0,2048) || !safeText(deviceName,1,100) || !safeText(value.deviceId,1,64))throw bad('WebDAV Invalid URL, account, or device name');
  let url;try{url=new URL(value.endpoint.trim());}catch{throw bad('Enter a valid HTTPS WebDAV Folder URL');}
  if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash || !url.hostname)throw bad('Use a HTTPS folder URL. Enter the username and password in their own fields');
  if(!url.pathname.endsWith('/'))url.pathname+='/';
  return {endpoint:url.href,username:value.username,password:value.password,deviceName,deviceId:value.deviceId};
}
function snapshot(value,now,allowExpired=false) {try{return normalizeHandoff(value,{now,allowExpired});}catch(error){throw bad(error.message);}}

/** Explicit user-selected HTTPS storage. No redirects, retries or credential persistence. */
export class WebDavHandoff {
  constructor({fetcher=fetch,now=Date.now,ownsSession=()=>true,timeout=30000}={}) {Object.assign(this,{fetcher,now,ownsSession,timeout});this.profiles=new Map();this.operations=new Map();}
  clearSession(id) {const profile=this.profiles.get(id);profile?.controller.abort();this.profiles.delete(id);for(const [key,value] of this.operations)if(value.session===id)this.operations.delete(key);}
  invalidate(id) {const p=this.profiles.get(id);if(p){p.controller.abort();p.controller=new AbortController();++p.epoch;p.pending=null;p.intent=0;p.remote=null;p.configRevision=token();}}
  profile(session) {
    for(const [id,value] of this.profiles)if(!this.ownsSession(value.session))this.clearSession(id);
    let p=this.profiles.get(session.id);if(!p){p={session,config:null,configRevision:token(),remote:null,controller:new AbortController(),epoch:0,intent:0,pending:null};this.profiles.set(session.id,p);while(this.profiles.size>100)this.clearSession(this.profiles.keys().next().value);}
    return p;
  }
  public(p) {return {connected:!!p.config,configRevision:p.configRevision,intent:p.intent,configuration:p.config?{endpoint:p.config.endpoint,username:p.config.username,deviceName:p.config.deviceName,deviceId:p.config.deviceId}:null,remote:p.remote?{snapshot:p.remote.snapshot,token:p.remote.token || '',expired:handoffExpired(p.remote.snapshot,this.now())}:null,needsRefresh:!!p.needsRefresh};}
  state(session) {return this.public(this.profile(session));}
  check(session,input) {
    const p=this.profile(session);
    if(!this.ownsSession(session) || input.revision!==session.accountRevision)throw changed();
    if(input.configRevision!==p.configRevision)throw new PlatformError('needs-refresh','WebDAV Connection status changed. Refresh before continuing',409);
    return p;
  }
  context(p,config=p.config) {return {p,config,generation:p.session.generation,epoch:p.epoch,signal:AbortSignal.any([p.controller.signal,AbortSignal.timeout(this.timeout)])};}
  guard(ctx) {if(this.profiles.get(ctx.p.session.id)!==ctx.p || !this.ownsSession(ctx.p.session) || ctx.generation!==ctx.p.session.generation || ctx.epoch!==ctx.p.epoch)throw changed();ctx.signal.throwIfAborted();}
  async request(ctx,method,name='',{body,etag}={}) {
    this.guard(ctx);const directory=new URL('Tinglan/',ctx.config.endpoint),url=new URL(name,directory);
    const headers={'Authorization':'Basic '+Buffer.from(ctx.config.username+':'+ctx.config.password,'utf8').toString('base64'),'User-Agent':'Tinglan-WebDAV/1','Cache-Control':'no-cache',...(body?{'Content-Type':'application/json; charset=utf-8'}:{}),...(etag?{[etag==='*'?'If-None-Match':'If-Match']:etag}:{})};
    let response;
    try {response=await this.fetcher(url.href,{method,headers,body,redirect:'manual',signal:ctx.signal});}
    catch {this.guard(ctx);throw new PlatformError('network','WebDAV Connection unavailable. Check the server and retry',503);}
    this.guard(ctx);
    if(response.status>=300 && response.status<400){await response.body?.cancel();throw new PlatformError('redirect','WebDAV The URL redirects. Enter the final HTTPS Folder URL',502);}
    const permitted=method==='MKCOL'?[200,201,204,405]:method==='GET'?[200,404]:[200,201,204];
    if(!permitted.includes(response.status)) {
      await response.body?.cancel();const status=response.status;
      const code=[401,403].includes(status)?'sign-in':status===412?'conflict':status===423?'locked':status===507?'storage-full':status===202?'write-unconfirmed':'unavailable';
      const message=code==='sign-in'?'WebDAV Incorrect account or folder permissions':code==='conflict'?'Another device updated playback. Refresh before handing off again':code==='locked'?'The server locked the handoff file. Retry later':code==='storage-full'?'WebDAV Not enough storage space':status===409?'WebDAV Parent folder missing. Enter an existing folder URL':code==='write-unconfirmed'?'Server has not confirmed saving the handoff. Refresh to verify':`WebDAV Request incomplete（HTTP ${status}），Retry later`;
      throw new PlatformError(code,message,code==='sign-in'?401:code==='conflict'?409:502);
    }
    if(method!=='GET' || response.status===404){await response.body?.cancel();return {status:response.status,etag:strongEtag(response.headers.get('etag'))};}
    if(Number(response.headers.get('content-length'))>HANDOFF_LIMITS.bytes){await response.body?.cancel();throw new PlatformError('invalid-response','Handoff file exceeds size limit');}
    const chunks=[];let size=0;
    try {if(response.body)for await(const chunk of response.body){this.guard(ctx);size+=chunk.length;if(size>HANDOFF_LIMITS.bytes)throw new PlatformError('invalid-response','Handoff file exceeds size limit');chunks.push(chunk);}}
    catch(error){if(error instanceof PlatformError)throw error;this.guard(ctx);throw new PlatformError('network','WebDAV Handoff file is incomplete. Refresh manually',503);}
    let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw new PlatformError('invalid-response','WebDAV Unable to parse handoff file');}
    const tag=strongEtag(response.headers.get('etag'));if(!tag)throw new PlatformError('invalid-response','The server did not provide a strong ETag，so multi-device handoff consistency cannot be guaranteed');
    return {snapshot:snapshot(value,this.now(),true),etag:tag};
  }
  async read(ctx) {const value=await this.request(ctx,'GET','playback.json');this.guard(ctx);ctx.p.remote=value.status===404?null:{...value,token:token()};ctx.p.needsRefresh=false;return ctx.p.remote;}
  async connect(session,input) {
    const p=this.check(session,input),config=webdavConfiguration(input),signature=createHash('sha256').update(JSON.stringify(config)).digest('hex');
    if(!Number.isSafeInteger(input.intent) || input.intent<1)throw bad('Invalid connection request identifier');
    if(p.pending && p.pendingKind==='connect' && input.intent===p.intent && signature===p.connectSignature)return p.pending;
    if(input.intent<=p.intent)throw changed();
    if(p.pending && p.pendingKind!=='connect')throw new PlatformError('busy','Handoff is running. Wait before changing the connection',409);
    p.controller.abort();p.controller=new AbortController();++p.epoch;p.intent=input.intent;p.connectSignature=signature;p.remote=null;const ctx=this.context(p,config);
    const work=Promise.resolve().then(async()=>{await this.request(ctx,'MKCOL');const value=await this.request(ctx,'GET','playback.json');this.guard(ctx);p.config=config;p.configRevision=token();p.remote=value.status===404?null:{...value,token:token()};p.needsRefresh=false;return {...this.public(p),notice:'Connected WebDAV'};}).finally(()=>{if(p.pending===work)p.pending=null;});
    p.pending=work;p.pendingKind='connect';return work;
  }
  async refresh(session,input) {
    const p=this.check(session,input);if(!p.config)throw bad('Connect your WebDAV');
    if(p.pending && p.pendingKind==='refresh')return p.pending;
    if(p.pending)throw new PlatformError('busy','Handoff is running. Wait for its result',409);
    const ctx=this.context(p),work=Promise.resolve().then(async()=>{await this.read(ctx);return this.public(p);}).catch(error=>{p.needsRefresh=true;throw error;}).finally(()=>{if(p.pending===work)p.pending=null;});p.pending=work;p.pendingKind='refresh';return work;
  }
  forget(session,input) {
    const p=this.check(session,input);if(!Number.isSafeInteger(input.intent) || input.intent<=p.intent)throw changed();
    p.controller.abort();p.controller=new AbortController();++p.epoch;p.pending=null;p.intent=input.intent;p.config=null;p.configRevision=token();p.remote=null;p.needsRefresh=false;return this.public(p);
  }
  async mutate(session,action,input) {
    const p=this.check(session,input);if(!p.config)throw bad('Connect your WebDAV');
    if(!['publish','claim'].includes(action) || !/^[a-f0-9]{48}$/.test(input.operation || ''))throw bad('Invalid handoff action identifier');
    const supplied=action==='publish'?snapshot(input.snapshot,this.now()):null;
    if(supplied && (supplied.deviceId!==p.config.deviceId || supplied.deviceName!==p.config.deviceName))throw bad('Handoff device identifier does not match the connection');
    const signature=JSON.stringify([action,supplied,input.remoteToken]),key=`${session.id}:${session.generation}:${p.configRevision}:${input.operation}`,previous=this.operations.get(key);
    if(previous){if(previous.signature!==signature)throw bad('This handoff action identifier was used for another request');return previous.promise;}
    if(p.pending)throw new PlatformError('busy','Handoff is running. Wait for its result',409);
    if(action==='claim' && (!p.remote?.etag || !p.remote.token || input.remoteToken!==p.remote.token || p.needsRefresh))throw new PlatformError('needs-refresh','Handoff status changed. Refresh before continuing',409);
    for(const [id,value] of this.operations)if(!value.pending && value.expiresAt<=this.now())this.operations.delete(id);
    if(this.operations.size>=128){const old=[...this.operations].find(([,value])=>!value.pending);if(!old)throw new PlatformError('busy','Too many handoff requests. Retry later',429);this.operations.delete(old[0]);}
    const journal={session:session.id,signature,pending:true,expiresAt:this.now()+600000},ctx=this.context(p);this.operations.set(key,journal);
    const work=Promise.resolve().then(async()=>{
      const current=action==='publish'?await this.read(ctx):p.remote;
      if(action==='claim' && handoffExpired(current.snapshot,this.now()))throw new PlatformError('expired','This handoff expired. Send it again from the source device',410);
      const value=action==='publish'?supplied:{...current.snapshot,deviceId:p.config.deviceId,deviceName:p.config.deviceName,updatedAt:this.now()};
      const payload=JSON.stringify(value);if(Buffer.byteLength(payload)>HANDOFF_LIMITS.bytes)throw bad('Handoff file exceeds size limit');
      const response=await this.request(ctx,'PUT','playback.json',{body:payload,etag:current?.etag || '*'});this.guard(ctx);
      p.remote={snapshot:value,etag:response.etag,token:response.etag?token():''};p.needsRefresh=!response.etag;
      return {...this.public(p),written:true,snapshot:value,notice:action==='publish'?'Playback position and queue sent':'Playback handoff received'};
    }).catch(error=>{if(this.profiles.get(session.id)===p && ctx.epoch===p.epoch)p.needsRefresh=true;if(!this.ownsSession(session) || ctx.epoch!==p.epoch || ctx.generation!==session.generation)throw changed();throw error;}).finally(()=>{journal.pending=false;if(p.pending===work)p.pending=null;});
    journal.promise=work;p.pending=work;p.pendingKind='mutation';return work;
  }
}

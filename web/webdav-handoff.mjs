import {normalizeHandoff,handoffExpired,handoffPlan} from './playback-handoff.mjs';

const nonce=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),byte=>byte.toString(16).padStart(2,'0')).join('');
const blank=()=>({loaded:false,connected:false,busy:false,configuration:null,configRevision:'',remote:null,needsRefresh:false,warning:'',notice:'',intent:0,pendingResume:false});
/** Manual relay with explicit ownership; a confirmed PUT remains confirmed if a later read fails. */
export class WebDavClient {
  constructor({platform,deviceId,changed=()=>{},capture=()=>null,outgoing,published=()=>{},prepare=async()=>{},continueHere=async()=>true,now=Date.now,operationId=nonce,sessionId=()=>crypto.randomUUID()}) {
    Object.assign(this,{platform,deviceId,changed,capture,outgoing,published,prepare,continueHere,now,operationId,sessionId});this.state=blank();this.revision=0;this.intent=0;this.active=false;this.pendingSnapshot=null;
  }
  patch(value) {this.state={...this.state,...value};this.changed(this.state);}
  owns(ctx) {return ctx.revision===this.revision && ctx.generation===this.platform.generation && ctx.account===this.platform.accountRevision;}
  accept(value) {
    if(typeof value?.connected!=='boolean' || !/^[a-f0-9]{32}$/.test(value.configRevision || '') || !Number.isSafeInteger(value.intent) || value.intent<0)throw new Error('WebDAV Invalid companion status');
    const config=value.configuration;
    if(value.connected && (!config || typeof config.endpoint!=='string' || !config.endpoint.startsWith('https://') || typeof config.username!=='string' || typeof config.deviceName!=='string' || typeof config.deviceId!=='string' || 'password' in config))throw new Error('WebDAV Invalid connection information');
    const remote=value.remote?{snapshot:normalizeHandoff(value.remote.snapshot,{now:this.now(),allowExpired:true}),token:String(value.remote.token || ''),expired:handoffExpired(value.remote.snapshot,this.now())}:null;
    if(remote && remote.token && !/^[a-f0-9]{32}$/.test(remote.token))throw new Error('WebDAV Invalid handoff identifier');
    this.intent=Math.max(this.intent,value.intent);this.patch({loaded:true,connected:value.connected,configRevision:value.configRevision,configuration:value.connected?{endpoint:config.endpoint,username:config.username,deviceName:config.deviceName,deviceId:config.deviceId}:null,remote,needsRefresh:!!value.needsRefresh,intent:value.intent});
  }
  async call(ctx,path,value) {
    const answer=await this.platform.request('/api/webdav'+path,{method:value?'POST':'GET',body:value?{...value,revision:ctx.account,configRevision:this.state.configRevision}:undefined,signal:ctx.controller.signal,timeoutMs:40000});
    ctx.controller.signal.throwIfAborted();if(!this.owns(ctx))throw new DOMException('WebDAV owner changed','AbortError');return answer;
  }
  async run(kind,task) {
    if(this.state.busy)return false;const ctx={revision:++this.revision,generation:this.platform.generation,account:this.platform.accountRevision,controller:new AbortController()};this.operation=ctx;this.kind=kind;this.patch({busy:true,warning:'',notice:''});
    try {await task(ctx);return this.owns(ctx);}
    catch(error){if(this.owns(ctx) && error.name!=='AbortError')this.patch({warning:error.message || 'Handoff incomplete. Check your connection and retry',needsRefresh:kind!=='local' && this.state.connected || this.state.needsRefresh});return false;}
    finally{if(this.owns(ctx)){this.operation=null;this.patch({busy:false});}}
  }
  async load(ctx,{refresh=false}={}) {
    this.accept(await this.call(ctx,''));
    if(refresh && this.state.connected)this.accept(await this.call(ctx,'/refresh',{}));
  }
  open() {this.active=true;if(this.state.loaded)return Promise.resolve(true);return this.run('read',ctx=>this.load(ctx,{refresh:true}));}
  refresh() {return this.run('read',ctx=>this.load(ctx,{refresh:true}));}
  connect(configuration) {
    return this.run('connect',async ctx=>{const intent=++this.intent;this.accept(await this.call(ctx,'/connect',{...configuration,deviceId:this.deviceId,intent}));this.pendingSnapshot=null;this.patch({pendingResume:false,notice:'Connected WebDAV'});});
  }
  forget() {
    return this.run('connect',async ctx=>{this.accept(await this.call(ctx,'/forget',{intent:++this.intent}));this.pendingSnapshot=null;this.patch({pendingResume:false,notice:'Disconnected WebDAV'});});
  }
  async refreshAfterWrite(ctx,notice) {
    this.patch({notice});
    try {this.accept(await this.call(ctx,'/refresh',{}));this.patch({notice});}
    catch(error){if(!this.owns(ctx) || error.name==='AbortError')return;this.patch({notice,needsRefresh:true,warning:`Handoff saved. Server status can be refreshed later. ${error.message || ''}`});}
  }
  publish() {
    if(!this.state.connected || this.state.needsRefresh)return Promise.resolve(false);
    const owner=this.capture();
    return this.run('write',async ctx=>{
      const snapshot=this.outgoing({deviceId:this.state.configuration.deviceId,deviceName:this.state.configuration.deviceName,sessionId:this.sessionId(),now:this.now()});
      const value=await this.call(ctx,'/publish',{snapshot,operation:this.operationId()});if(value.written!==true)throw new Error('Server did not confirm the handoff. Refresh to verify');this.accept(value);
      const paused=this.published(normalizeHandoff(value.snapshot,{now:this.now()}),owner);
      await this.refreshAfterWrite(ctx,paused===false?'Position and queue sent. Your changed local playback is kept':'Position and queue sent. Local playback paused');
    });
  }
  claim() {
    const remote=this.state.remote;if(!this.state.connected || this.state.needsRefresh || !remote?.token || handoffExpired(remote.snapshot,this.now()))return Promise.resolve(false);
    const owner=this.capture();
    return this.run('write',async ctx=>{
      const plan=handoffPlan(remote.snapshot,{now:this.now()});await this.prepare(plan,owner);if(!this.owns(ctx))return;
      const value=await this.call(ctx,'/claim',{remoteToken:remote.token,operation:this.operationId()});if(value.written!==true)throw new Error('Server did not confirm claiming this handoff. Refresh to verify');this.accept(value);this.pendingSnapshot=normalizeHandoff(value.snapshot,{now:this.now()});this.patch({pendingResume:true,notice:'Handoff received. Loading player'});
      let notice;
      try {const applied=await this.continueHere(handoffPlan(this.pendingSnapshot,{now:this.now()}),owner);if(!this.owns(ctx))return;if(applied){this.pendingSnapshot=null;this.patch({pendingResume:false});notice='Handoff loaded in player';}else notice='Handoff received. Local playback changed; start the received playback later';}
      catch(error){if(!this.owns(ctx))return;notice='Handoff received. Local playback has not started';this.patch({warning:error.message || 'Local library save incomplete'});}
      const localWarning=this.state.warning;await this.refreshAfterWrite(ctx,notice);if(localWarning && this.owns(ctx))this.patch({warning:localWarning+(this.state.warning?`；${this.state.warning}`:'')});
    });
  }
  resumeReceived() {
    if(!this.pendingSnapshot)return Promise.resolve(false);const owner=this.capture();
    return this.run('local',async ctx=>{const plan=handoffPlan(this.pendingSnapshot,{now:this.now()});await this.prepare(plan,owner);if(!this.owns(ctx))return;const applied=await this.continueHere(plan,owner);if(!this.owns(ctx))return;if(applied){this.pendingSnapshot=null;this.patch({pendingResume:false,notice:'Handoff loaded in player'});}else this.patch({notice:'Local playback changed. You can start the received handoff later'});});
  }
  view() {
    const s=this.state,c=s.configuration,r=s.remote,selected=r?.snapshot.tracks[r.snapshot.index];let issue='';
    if(r)try{handoffPlan(r.snapshot,{now:this.now()});}catch(error){issue=error.message;}
    return {loaded:s.loaded,connected:s.connected,busy:s.busy,configRevision:s.configRevision,endpoint:c?.endpoint || '',username:c?.username || '',deviceName:c?.deviceName || 'Tinglan Web',warning:s.warning,notice:s.notice,needsRefresh:s.needsRefresh,pendingResume:s.pendingResume,
      remoteTitle:selected?.title || '',remoteArtist:selected?.artist || '',remoteDevice:r?.snapshot.deviceName || '',remoteCount:r?.snapshot.tracks.length || 0,remotePosition:r?.snapshot.positionMs || 0,remoteUpdatedAt:r?.snapshot.updatedAt || 0,remoteExpired:r?handoffExpired(r.snapshot,this.now()):false,incomingIssue:issue,canReceive:!!r?.token && !issue && !s.needsRefresh};
  }
  close() {this.active=false;if(this.kind==='read' && this.operation){++this.revision;this.operation.controller.abort();this.operation=null;this.patch({busy:false});}}
  clear() {++this.revision;this.operation?.controller.abort();this.operation=null;this.pendingSnapshot=null;this.intent=0;this.state=blank();this.changed(this.state);}
}

/* Scheduling and ownership policy aligned with Android SessionRenewalController. */
import {SessionRenewalProtocols} from './session-renewal-protocols.mjs';
import {renewableCredential,accountIdentity} from './session-credentials.mjs';

export const RENEWAL_INTERVALS=Object.freeze({healthy:6*3600000,refreshed:6*3600000,rejected:3600000,unavailable:300000,force:60000});
export class SessionRenewal {
  constructor({providers,now=Date.now,protocols=new SessionRenewalProtocols(providers,{now}),ownsSession=()=>true,changed=()=>{},canStart=()=>true,setTimer=setTimeout,clearTimer=clearTimeout}){
    Object.assign(this,{providers,protocols,now,ownsSession,changed,canStart,setTimer,clearTimer});this.records=new Map();
  }
  key(session,source){return session.id+':'+source;}
  current(record){return this.records.get(this.key(record.session,record.source))===record && this.ownsSession(record.session) && record.cookie===record.session.cookies[record.source];}
  clearSource(session,source){const key=this.key(session,source),record=this.records.get(key);if(record){this.clearTimer(record.timer);record.controller.abort();record.credential=null;record.cookie='';this.records.delete(key);}}
  clearSession(id){for(const record of this.records.values())if(record.session.id===id)this.clearSource(record.session,record.source);}
  install(session,source,credential){
    this.clearSource(session,source);const cookie=session.cookies[source];
    if(!cookie || !renewableCredential(source,credential,cookie))return;
    const record={session,source,credential,cookie,version:0,controller:new AbortController(),outcome:'healthy',nextCheck:this.now()+RENEWAL_INTERVALS.healthy,checkedAt:this.now(),forcedAt:-Infinity,error:'',pending:null,timer:null};
    this.records.set(this.key(session,source),record);this.schedule(record);
  }
  state(session,source){
    const record=this.records.get(this.key(session,source));if(!record || !this.current(record))return {automaticRenewal:false,renewalStatus:'missing',renewalError:'',nextRenewalAt:0};
    return {automaticRenewal:true,renewalStatus:record.pending?'checking':record.outcome,renewalError:record.error,nextRenewalAt:record.nextCheck};
  }
  schedule(record){
    this.clearTimer(record.timer);record.timer=null;
    if(!this.current(record)){this.clearSource(record.session,record.source);return;}
    const expiry=Number.isFinite(record.session.expiry)?record.session.expiry:Infinity;
    record.timer=this.setTimer(()=>{record.timer=null;void this.renew(record.session,record.source).finally(()=>{if(this.current(record) && !record.pending && record.timer===null)this.schedule(record);}).catch(()=>{});},Math.max(1,Math.min(record.nextCheck,expiry)-this.now()));record.timer?.unref?.();
  }
  snapshot(record){return {source:record.source,credential:record.credential,cookie:record.cookie,signal:record.controller.signal,identity:`${record.session.id}:renewal:${record.source}:${record.version}`};}
  renew(session,source,{force=false}={}){
    if(!session?.id)return Promise.resolve('missing');
    const record=this.records.get(this.key(session,source));if(!record)return Promise.resolve('missing');if(!this.current(record)){this.clearSource(session,source);return Promise.resolve('missing');}
    if(record.pending)return record.pending;
    const now=this.now();
    if(now<record.nextCheck && (!force || ['deferred','rejected'].includes(record.outcome)) || force && (now<record.forcedAt+RENEWAL_INTERVALS.force || record.outcome==='refreshed' && now<record.checkedAt+RENEWAL_INTERVALS.force))return Promise.resolve(record.outcome);
    if(!this.canStart(session,source)){record.nextCheck=now+RENEWAL_INTERVALS.force;this.schedule(record);return Promise.resolve('deferred');}
    this.clearTimer(record.timer);record.timer=null;record.checkedAt=now;if(force)record.forcedAt=now;
    const operation=Promise.resolve().then(async()=>{
      try{
        if(!this.current(record))return 'superseded';
        const answer=await this.protocols.refresh(this.snapshot(record),force);
        if(!this.current(record))return 'superseded';
        if(!['healthy','rejected','refreshed','confirmed'].includes(answer.outcome))throw new Error('Invalid renewal result');
        if(answer.outcome==='refreshed'){
          if(!renewableCredential(source,answer.credential,answer.cookie) || accountIdentity(source,answer.cookie)!==accountIdentity(source,record.cookie))throw new Error('Invalid renewal snapshot');
          // The old record identity and cookie are the compare-and-set boundary.
          session.cookies[source]=answer.cookie;record.cookie=answer.cookie;record.credential=answer.credential;++record.version;
          session.authRevision=(session.authRevision || 0)+1;this.providers.net?.clearIdentity?.(session.id);this.changed(session,source);
          if(record.credential.pendingConfirm){await this.protocols.confirm(this.snapshot(record));if(!this.current(record))return 'superseded';delete record.credential.pendingConfirm;}
        }else if(answer.outcome==='confirmed')delete record.credential.pendingConfirm;
        record.outcome=answer.outcome==='confirmed'?'refreshed':answer.outcome;
        record.error=answer.outcome==='rejected'?'The platform rejected renewal credentials. Sign in with a new QR code.':'';
        record.nextCheck=this.now()+RENEWAL_INTERVALS[record.outcome];return record.outcome;
      }catch(error){
        if(!this.current(record))return 'superseded';
        const delayed=['verification','cooldown','busy','rate-limit'].includes(error.code) || error.status===429;
        record.outcome=delayed?'deferred':error.code==='sign-in'?'rejected':'unavailable';
        record.error=delayed?'The platform requested a delay. Automatic renewal paused.':record.outcome==='rejected'?'The platform rejected renewal credentials. Sign in with a new QR code.':'Renewal incomplete. Existing session kept; retrying later.';
        record.nextCheck=this.now()+(delayed?Math.min(300000,Math.max(60000,(Number(error.retryAfter) || 60)*1000)):RENEWAL_INTERVALS[record.outcome]);return record.outcome;
      }finally{if(this.current(record)){record.pending=null;this.schedule(record);}}
    });record.pending=operation;return operation;
  }
}

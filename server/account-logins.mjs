import {PlatformError} from './upstream.mjs';
import {LoginProtocols} from './login-protocols.mjs';

export const ACCOUNT_SOURCES=['qq','bili','netease'];
const terminal=new Set(['authorized','expired','refused','error']);
const expired=()=>new PlatformError('expired','Sign-in QR code expired. Request another',410);

/** Bounded, session-owned QR records. A cancelled/obsolete authorization cannot install credentials. */
export class AccountLogins {
  constructor({providers,now=Date.now,protocols=new LoginProtocols(providers,{now}),install,renewal,ownsSession=()=>true}) {
    Object.assign(this,{protocols,install,renewal,now,ownsSession});this.records=new Map();this.checks=new Map();
  }
  clearPrivate(record) {record.key='';record.cookies=null;record.device='';record.url='';record.image=null;}
  remove(record) {record.controller.abort();this.clearPrivate(record);this.records.delete(record.id);}
  clearSession(sessionId) {for(const record of this.records.values())if(record.session.id===sessionId)this.remove(record);}
  prune() {for(const record of this.records.values())if(record.expiresAt<=this.now() || !this.ownsSession(record.session))this.remove(record);}
  current(record) {return this.records.get(record.id)===record && record.generation===record.session.generation && record.expiresAt>this.now() && this.ownsSession(record.session);}
  find(id,session) {this.prune();const record=this.records.get(id);if(!record || record.session!==session || !this.current(record))throw expired();return record;}
  public(record) {return {id:record.id,source:record.source,method:record.method,status:record.status,expiresAt:record.expiresAt,pollAfterMs:2500,error:record.error || '',url:record.url || '',imagePath:record.image?'/api/login/image?id='+record.id:''};}
  async start(session,source,method,{id,intent,revision}={}) {
    if(!ACCOUNT_SOURCES.includes(source) || method!==(source==='qq'?'qq':'qr'))throw new PlatformError('invalid-request','Invalid sign-in method',400);
    if(!/^[a-f0-9]{48}$/.test(id || '') || !Number.isSafeInteger(intent) || intent<1)throw new PlatformError('invalid-request','Invalid sign-in request identifier',400);
    if(revision!==session.accountRevision)throw new PlatformError('session-changed','Account changed. Retry',409);
    if(intent<=(session.loginIntent || 0) || this.records.has(id))throw expired();session.loginIntent=intent;
    this.prune();this.clearSession(session.id);
    const record={id,session,generation:session.generation,source,method,controller:new AbortController(),status:'creating',expiresAt:this.now()+180000,nextPoll:0};
    this.records.set(record.id,record);while(this.records.size>32)this.remove(this.records.values().next().value);
    try {
      const challenge=await this.protocols.start(record);
      if(!this.current(record))throw expired();record.url=challenge.url || '';record.image=challenge.image || null;record.status='waiting';
      return this.public(record);
    } catch(error) {this.remove(record);throw error;}
  }
  cancel(id,session,{intent,revision}={}) {
    // Cancelling before a delayed start reaches the server also rejects that obsolete intent.
    if(revision===session.accountRevision && Number.isSafeInteger(intent) && intent>0)session.loginIntent=Math.max(session.loginIntent || 0,intent);
    const record=this.records.get(id);if(record?.session===session)this.remove(record);
  }
  async poll(session,id) {
    const record=this.find(id,session);if(record.promise)return record.promise;
    if(terminal.has(record.status) || record.nextPoll>this.now())return this.public(record);
    record.nextPoll=this.now()+2500;
    const operation=(async()=>{
      try {
        const answer=await this.protocols.poll(record);if(!this.current(record))throw expired();
        if(!['waiting','scanned','expired','refused','authorized'].includes(answer.status))throw new PlatformError('invalid-response','The platform has not confirmed the scan status');
        if(answer.status==='authorized') {
          if(typeof answer.cookie!=='string' || !answer.cookie || answer.cookie.length>12000 || /[\r\n]/.test(answer.cookie))throw new PlatformError('invalid-response','The platform returned an invalid sign-in session');
          const result={...this.public(record),status:'authorized',url:'',imagePath:''};
          // This synchronous commit is the ownership boundary; install invalidates all in-flight account operations.
          this.install(session,record.source,answer.cookie,answer.credential);return result;
        }
        record.status=answer.status;if(terminal.has(record.status))this.clearPrivate(record);return this.public(record);
      }catch(error) {
        if(!this.current(record))throw expired();record.status='error';record.error=error instanceof PlatformError?error.message:'Sign-in connection unavailable. Retry manually';this.clearPrivate(record);return this.public(record);
      }finally{record.promise=null;}
    })();record.promise=operation;return operation;
  }
  image(session,id) {const record=this.find(id,session);if(!record.image || terminal.has(record.status))throw expired();return record.image;}
  accounts(session) {
    return {revision:session.accountRevision,accounts:ACCOUNT_SOURCES.map(source=>({source,connected:!!session.cookies[source],status:session.cookies[source]?(session.accounts?.[source]?.status || 'unverified'):'disconnected',name:session.accounts?.[source]?.name || '',error:session.accounts?.[source]?.error || '',...(this.renewal?.state(session,source) || {automaticRenewal:false,renewalStatus:'missing',renewalError:'',nextRenewalAt:0})}))};
  }
  async verify(session,source) {
    if(!ACCOUNT_SOURCES.includes(source))throw new PlatformError('invalid-request','Invalid platform',400);
    if(!session.cookies[source])return this.accounts(session);
    const generation=session.generation,key=session.id+':'+generation+':'+source;if(this.checks.has(key))return this.checks.get(key);
    const operation=(async()=>{
      let value;
      try {
        await this.renewal?.renew(session,source);
        let profile;const usedCookie=session.cookies[source];
        try{profile=await this.protocols.profile(source,session);}catch(error){
          if(error.code!=='sign-in')throw error;
          if(session.cookies[source]===usedCookie)await this.renewal?.renew(session,source,{force:true});
          if(generation!==session.generation || !usedCookie || usedCookie===session.cookies[source])throw error;
          profile=await this.protocols.profile(source,session);
        }
        value={status:'verified',name:profile.name,error:''};
      }
      catch(error){value={status:error.code==='sign-in'?'expired':'check-failed',name:'',error:error instanceof PlatformError?error.message:'Unable to verify account. Retry manually'};}
      if(generation!==session.generation || !this.ownsSession(session))throw new PlatformError('session-changed','Account changed. Retry',409);
      session.accounts ||= {};session.accounts[source]=value;return this.accounts(session);
    })();this.checks.set(key,operation);try{return await operation;}finally{this.checks.delete(key);}
  }
}

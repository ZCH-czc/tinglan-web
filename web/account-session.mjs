import {hostSetTimeout,hostClearTimeout} from './host-api.mjs';
const id=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join('');
const empty=()=>({source:'',method:'',status:'idle',error:'',remaining:0,qrRows:[],imageKey:''});
/** A visible QR dialog owns one polling loop; never persist tokens, images or account credentials. */
export class AccountSession {
  constructor({platform,encode,deliverImage,connected=async()=>{},changed=()=>{},hidden=()=>false,now=Date.now,setTimer=hostSetTimeout,clearTimer=hostClearTimeout,nonce=id}) {
    Object.assign(this,{platform,encode,deliverImage,connected,changed,hidden,now,setTimer,clearTimer,nonce});this.state=empty();this.revision=0;this.intent=0;this.active=false;
  }
  patch(value){this.state={...this.state,...value};this.changed(this.state);}
  cancelRemote(attempt){if(attempt)Promise.resolve(this.platform.request('/api/login/cancel',{method:'POST',body:attempt})).catch(()=>{});}
  clearImage(){if(this.state.imageKey)this.deliverImage(this.state.imageKey,null);}
  close() {
    ++this.revision;this.active=false;this.pending=false;this.abort?.abort();this.clearTimer(this.timer);this.timer=null;this.cancelRemote(this.attempt);this.attempt=null;this.clearImage();this.patch(empty());
  }
  async start(source,method=source==='qq'?'qq':'qr') {
    this.close();this.active=true;const revision=this.revision;this.abort=new AbortController();const signal=this.abort.signal;
    this.patch({...empty(),source,method,status:'creating'});
    try {
      if(!this.platform.accountRevision)await this.platform.refreshAccounts(signal);signal.throwIfAborted();
      this.intent=Math.max(this.intent+1,this.now()*1000);this.attempt={id:this.nonce(),intent:this.intent,revision:this.platform.accountRevision};const attempt=this.attempt;
      const challenge=await this.platform.request('/api/login/start',{method:'POST',body:{...attempt,source,method},signal});
      if(revision!==this.revision){this.cancelRemote(attempt);return;}
      if(challenge.id!==attempt.id || challenge.source!==source || !Number.isFinite(challenge.expiresAt) || challenge.expiresAt<=this.now())throw new Error('Sign-in code expired. Request a new one');
      this.expiresAt=challenge.expiresAt;
      let rows=[],imageKey='';
      if(challenge.url)rows=await this.encode(challenge.url);
      else if(challenge.imagePath===`/api/login/image?id=${attempt.id}`) {
        imageKey='login-qr-'+attempt.id;
        try{await this.deliverImage(imageKey,challenge.imagePath,signal);}catch(error){this.deliverImage(imageKey,null);throw error;}
      }else throw new Error('The platform did not provide a sign-in code');
      if(revision!==this.revision){if(imageKey)this.deliverImage(imageKey,null);return;}
      this.patch({status:'waiting',qrRows:rows,imageKey,error:'',remaining:Math.ceil((this.expiresAt-this.now())/1000)});this.schedule();
    }catch(error){if(revision===this.revision && error.name!=='AbortError'){this.cancelRemote(this.attempt);this.clearImage();this.patch({status:'error',error:error.message || 'Unable to load sign-in code',qrRows:[],imageKey:''});}}
  }
  schedule() {this.clearTimer(this.timer);this.timer=null;if(this.active && !this.hidden() && ['waiting','scanned'].includes(this.state.status))this.timer=this.setTimer(()=>{this.timer=null;this.poll();},2500);}
  async poll() {
    if(!this.active || this.hidden() || this.pending || !['waiting','scanned'].includes(this.state.status))return;
    const revision=this.revision,attempt=this.attempt,signal=this.abort.signal;
    if(this.now()>=this.expiresAt){this.clearImage();this.cancelRemote(attempt);this.patch({status:'expired',remaining:0,qrRows:[],imageKey:''});return;}
    this.pending=true;
    try {
      const answer=await this.platform.request('/api/login/poll',{method:'POST',body:{id:attempt.id},signal});
      if(revision!==this.revision)return;
      if(!['waiting','scanned','authorized','expired','refused','error'].includes(answer.status))throw new Error('The platform has not confirmed the scan status');
      if(answer.status==='authorized') {
        this.clearImage();this.patch({status:'authorized',qrRows:[],imageKey:'',remaining:0,error:''});this.attempt=null;
        try {await this.platform.invalidateAccount?.();const value=await this.platform.refreshAccounts(signal);if(revision===this.revision)await this.connected(this.state.source,value);}
        catch(error){if(revision===this.revision && error.name!=='AbortError')this.patch({error:'Authorized. Account details are pending; return to Accounts and refresh'});}return;
      }
      if(['expired','refused','error'].includes(answer.status)){this.clearImage();this.cancelRemote(attempt);this.patch({status:answer.status,error:answer.error || '',qrRows:[],imageKey:'',remaining:0});return;}
      this.patch({status:answer.status,remaining:Math.max(0,Math.ceil((this.expiresAt-this.now())/1000))});
    }catch(error){if(revision===this.revision && error.name!=='AbortError'){this.clearImage();this.cancelRemote(attempt);this.patch({status:error.code==='expired'?'expired':'error',error:error.message || 'Sign-in connection lost. Retry manually',qrRows:[],imageKey:''});}}
    finally {if(revision===this.revision){this.pending=false;this.schedule();}}
  }
  visibility() {
    this.clearTimer(this.timer);this.timer=null;
    // Keep a single in-flight request to avoid overlapping status calls when returning to the page.
    if(!this.hidden() && this.active)this.poll();
  }
}

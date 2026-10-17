const sources=['qq','bili','netease'];
const statuses=new Set(['disconnected','unverified','verified','expired','check-failed']);
function publicAccounts(value) {
  if(!Array.isArray(value?.accounts) || sources.some(source=>value.accounts.filter(row=>row?.source===source).length!==1))throw new Error('Incomplete account response. Update the Tinglan companion');
  return {accounts:sources.map(source=>{
    const row=value.accounts.find(row=>row.source===source);
    return {source,connected:row.connected===true,status:statuses.has(row.status)?row.status:'unverified',name:typeof row.name==='string'?row.name.slice(0,200):'',error:typeof row.error==='string'?row.error.slice(0,600):'',automaticRenewal:row.automaticRenewal===true,renewalStatus:['missing','healthy','checking','refreshed','rejected','unavailable','deferred'].includes(row.renewalStatus)?row.renewalStatus:'missing',renewalError:typeof row.renewalError==='string'?row.renewalError.slice(0,600):'',nextRenewalAt:Number.isSafeInteger(row.nextRenewalAt) && row.nextRenewalAt>0?row.nextRenewalAt:0};
  })};
}
/** Coalesced, non-persistent status metadata. A late read cannot overwrite a newer login or verification. */
export class AccountStatusReader {
  constructor(platform,{changed=()=>{}}={}) {
    this.platform=platform;this.changed=changed;this.revision=0;
    this.state={loaded:false,loading:false,value:{accounts:[]},error:''};
  }
  patch(value){this.state={...this.state,...value};this.changed(this.state);}
  accept(value) {
    const metadata=publicAccounts(value);
    ++this.revision;this.abort?.abort();this.pending=null;
    this.patch({loaded:true,loading:false,value:metadata,error:''});
  }
  refresh() {
    if(this.pending)return this.pending;
    const revision=++this.revision,abort=new AbortController();this.abort=abort;
    this.patch({loading:true,error:''});
    const operation=(async()=>{
      // Schedule after installing pending so an immediate/synchronous provider also has a single owner.
      await Promise.resolve();
      try {
        const value=await this.platform.refreshAccounts(abort.signal);
        if(revision!==this.revision || abort.signal.aborted)return null;
        this.patch({loaded:true,value:publicAccounts(value),error:''});return value;
      }catch(error){
        if(revision===this.revision && !abort.signal.aborted && error.name!=='AbortError')this.patch({error:(error.message || 'Account service unavailable. Check the local companion').slice(0,600)});
        return null;
      }finally {
        if(revision===this.revision){this.pending=null;this.patch({loading:false});}
      }
    })();this.pending=operation;return operation;
  }
}

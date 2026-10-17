import {tr} from './i18n.mjs';
import {hostFetch,hostSetTimeout,hostClearTimeout} from './host-api.mjs';
import {LAN_LIMITS,privateIpv4,lanTarget} from './lan-transfer-policy.mjs';

const blank=()=>({loaded:false,active:false,busy:false,addresses:[],receipts:[],filename:'',progress:0,warning:'',notice:'',importing:'',needsStop:false,qrRows:[]});
/** Only the visible receive page renews the listener lease. Files commit before import acknowledgment. */
export class LanTransferClient {
  constructor({platform,encode,importFile,fetcher=hostFetch,changed=()=>{},now=Date.now,schedule=hostSetTimeout,cancel=hostClearTimeout}) {Object.assign(this,{platform,encode,importFile,fetcher,changed,now,schedule,cancel});this.state=blank();this.intent=0;this.epoch=0;this.visible=false;this.rawUrl='';this.failed=new Set();this.saved=new Set();}
  patch(value){this.state={...this.state,...value};this.changed(this.state);}
  context(){return {epoch:this.epoch,generation:this.platform.generation,account:this.platform.accountRevision,signal:this.controller.signal};}
  owns(ctx){return ctx.epoch===this.epoch && ctx.generation===this.platform.generation && ctx.account===this.platform.accountRevision && !ctx.signal.aborted;}
  resetLife(){++this.epoch;this.controller?.abort();this.controller=new AbortController();this.cancel(this.timer);this.timer=null;this.reading=null;this.importing=null;}
  async accept(value,ctx) {
    if(!this.owns(ctx))return false;
    if(typeof value?.active!=='boolean' || !Number.isSafeInteger(value.intent) || value.intent<0 || !Array.isArray(value.addresses) || value.addresses.length>16 || value.addresses.some(row=>!privateIpv4(row.address) || typeof row.name!=='string' || row.name.length>100) || !Array.isArray(value.receipts) || value.receipts.length>20 || value.receipts.some(row=>!/^[a-f0-9]{48}$/.test(row.id) || !/^[a-f0-9]{64}$/.test(row.sha256) || !Number.isSafeInteger(row.size) || row.size<1 || row.size>LAN_LIMITS.fileBytes || typeof row.name!=='string' || row.name.length>180 || !['pending','failed','imported'].includes(row.status)))throw new Error(tr("Invalid LAN receiver status"));
    if(value.active)lanTarget(value.url);
    let rows=this.state.qrRows;
    if(value.url!==this.rawUrl){rows=value.active?await this.encode(value.url):[];if(!this.owns(ctx))return false;this.failed.clear();this.saved.clear();}
    this.rawUrl=value.active?value.url:'';this.intent=Math.max(this.intent,value.intent);
    const receipts=value.receipts.map(row=>({id:row.id,name:row.name,size:row.size,sha256:row.sha256,status:row.status,error:String(row.error || '').slice(0,180)}));
    const retained=JSON.stringify(receipts)===JSON.stringify(this.state.receipts)?this.state.receipts:receipts;
    this.patch({loaded:true,active:value.active,addresses:value.addresses,receipts:retained,qrRows:rows,expiresAt:value.expiresAt || 0,filename:value.filename || '',progress:value.totalBytes?Math.min(1,value.receivedBytes/value.totalBytes):0,receiving:!!value.receiving,needsStop:false});return true;
  }
  async request(ctx,path,body) {const answer=await this.platform.request('/api/lan'+path,{signal:ctx.signal,method:body?'POST':'GET',body:body?{...body,revision:ctx.account}:undefined});ctx.signal.throwIfAborted();return answer;}
  async open(){this.visible=true;this.resetLife();this.failures=0;const ctx=this.context();this.patch({busy:true,warning:''});try{await this.accept(await this.request(ctx,''),ctx);if(this.owns(ctx))this.pollLater();}catch(error){if(this.owns(ctx))this.patch({warning:error.message});}finally{if(this.owns(ctx))this.patch({busy:false});}}
  async start(address) {
    if(this.state.busy || this.state.active || this.state.needsStop)return false;this.resetLife();const ctx=this.context();this.patch({busy:true,warning:'',notice:''});
    try{await this.accept(await this.request(ctx,'/start',{address,intent:++this.intent}),ctx);if(this.owns(ctx)){this.failures=0;this.pollLater();return this.state.active;}}
    catch(error){if(this.owns(ctx))this.patch({warning:error.message});}
    finally{if(this.owns(ctx))this.patch({busy:false});}return false;
  }
  pollLater(){this.cancel(this.timer);if(this.visible && this.state.active)this.timer=this.schedule(()=>this.poll(),1000);}
  async poll() {
    if(!this.visible || !this.state.active || this.reading)return;
    const ctx=this.context(),work=(async()=>{
      try{await this.accept(await this.request(ctx,'?'+new URLSearchParams({heartbeat:'1',revision:ctx.account})),ctx);if(this.owns(ctx)){this.failures=0;this.drain(ctx);}}
      catch(error){if(this.owns(ctx)){this.patch({warning:error.message});if(++this.failures>=3){this.resetLife();this.patch({active:false,qrRows:[],needsStop:true,warning:tr("Companion connection lost. The receiver closes when its short lease expires. Stop and restart receiving")});}}}
      finally{if(this.owns(ctx)){this.reading=null;this.pollLater();}}
    })();this.reading=work;return work;
  }
  drain(ctx=this.context()) {
    if(this.importing || !this.owns(ctx) || !this.state.active)return;
    const row=this.state.receipts.find(row=>row.status==='pending' && !this.failed.has(row.id));if(!row)return;
    this.patch({importing:row.name});
    const work=(async()=>{
      try {
        if(!this.saved.has(row.id)) {
          const response=await this.fetcher('/api/lan/file?'+new URLSearchParams({id:row.id,revision:ctx.account}),{signal:ctx.signal,credentials:'same-origin'});
          if(!response.ok)throw new Error(tr("Unable to read received audio. Send it again"));
          const blob=await response.blob();ctx.signal.throwIfAborted();if(!this.owns(ctx))return;
          if(blob.size!==row.size)throw new Error(tr("Audio was not fully received. Send it again"));
          await this.importFile(new File([blob],row.name,{type:'application/octet-stream',lastModified:0}),{signal:ctx.signal,sha256:row.sha256});ctx.signal.throwIfAborted();if(!this.owns(ctx))return;this.saved.add(row.id);
        }
        await this.accept(await this.request(ctx,'/ack',{id:row.id,ok:true}),ctx);if(this.owns(ctx))this.patch({notice:tr("Track added to local music"),warning:''});
      }catch(error){if(this.owns(ctx)){this.failed.add(row.id);this.patch({warning:error.message});try{await this.accept(await this.request(ctx,'/ack',{id:row.id,ok:false,error:error.message}),ctx);}catch{/* Preserve the failure until a manual retry. */}}}
      finally{if(this.owns(ctx)){this.importing=null;this.patch({importing:''});this.drain(ctx);}}
    })();this.importing=work;return work;
  }
  retry(id){const row=this.state.receipts.find(row=>row.id===id);if(!row || row.status==='imported' || this.importing)return;this.failed.delete(id);this.patch({receipts:this.state.receipts.map(row=>row.id===id?{...row,status:'pending',error:''}:row)});return this.drain();}
  async stop({leave=false}={}) {
    const hadActivity=this.state.active || this.state.busy || this.state.needsStop;this.resetLife();if(leave)this.visible=false;const ctx=this.context();this.rawUrl='';this.patch({busy:hadActivity,qrRows:[],importing:''});
    if(!hadActivity){this.patch({active:false,busy:false});return true;}
    try{await this.accept(await this.request(ctx,'/stop',{intent:++this.intent}),ctx);if(this.owns(ctx)){this.patch({active:false,busy:false,notice:tr("Receiving ended"),warning:'',needsStop:false});return true;}}
    catch(error){if(this.owns(ctx))this.patch({busy:false,active:false,needsStop:true,warning:tr("Stopping is not confirmed. The service closes automatically when its heartbeat lease expires")+error.message});}return false;
  }
  clear(){this.visible=false;this.resetLife();this.rawUrl='';this.failed.clear();this.saved.clear();this.state=blank();this.changed(this.state);}
  view(){const {qrRows,...value}=this.state;return value;}
}

import {tr} from './i18n.mjs';
import {LOCAL_INDEX} from './local-index-data.mjs';
import {LocalIndexDecoder} from './local-index-decoder.mjs';
import {LocalIndexWorker} from './local-index-client.mjs';
/** A resumable one-file queue. Derived data commits only while both media and index epochs still match. */
export class LocalIndexManager {
  constructor(index,{worker=new LocalIndexWorker(),decoder=new LocalIndexDecoder(),changed=()=>{},canBuild=()=>true}={}){
    Object.assign(this,{index,worker,decoder,changed,canBuild});this.sequence=0;this.disposed=false;this.lastNotify=0;this.state={building:false,indexed:0,bytes:0,eligible:0,done:0,total:0,failed:0,progress:0,title:'',kind:'',notice:'',error:''};
    decoder.changed=()=>{this.cachedView=null;if(!this.disposed)this.changed();};
  }
  get busy(){return this.state.building || !!this.decoder.pending;}
  view(){return this.cachedView ||= {...this.state,busy:this.busy,waitingDecoder:!!this.decoder.pending && !this.state.building};}
  patch(value,{throttle=false}={}){this.state={...this.state,...value};this.cachedView=null;if(this.disposed)return;const notify=()=>{clearTimeout(this.notifyTimer);this.notifyTimer=null;this.lastNotify=Date.now();this.changed();};if(!throttle || Date.now()-this.lastNotify>=250)notify();else if(!this.notifyTimer)this.notifyTimer=setTimeout(notify,250-(Date.now()-this.lastNotify));}
  refresh(){
    if(this.disposed)return Promise.resolve();if(this.refreshing){this.refreshAgain=true;return this.refreshing;}
    this.refreshing=(async()=>{try{const [info,eligible]=await Promise.all([this.index.info(),this.index.eligible()]);if(!this.disposed)this.patch({indexed:info.count,bytes:info.bytes,eligible:eligible.length},{throttle:true});}catch{if(!this.disposed)this.patch({error:tr("Unable to read fingerprint status. Retry later")});}finally{this.refreshing=null;if(this.refreshAgain){this.refreshAgain=false;void this.refresh();}}})();return this.refreshing;
  }
  async build(){
    if(this.busy || !this.canBuild() || this.disposed)return false;this.cancel('');const controller=new AbortController(),sequence=++this.sequence;this.controller=controller;const owns=()=>sequence===this.sequence && !controller.signal.aborted;
    this.patch({building:true,done:0,total:0,failed:0,progress:0,error:'',notice:'',kind:'preparing',title:''});
    try{
      const epoch=await this.index.epoch(),songs=await this.index.eligible();controller.signal.throwIfAborted();await this.index.prune(songs.map(s=>s.id),{signal:controller.signal});this.patch({total:songs.length});
      for(const song of songs){
        controller.signal.throwIfAborted();this.patch({title:song.title || tr("Untitled track"),progress:0,kind:'preparing'},{throttle:true});
        try{
          const source=await this.index.source(song.id,{signal:controller.signal});if(!source)throw new Error(tr("Audio removed"));if(source.epoch!==epoch)throw Object.assign(new Error(tr("Index cleared in another page. Indexing paused")),{code:'index-changed'});
          const old=await this.index.store.read('fingerprints',song.id);let current=false;
          if(old?.version===LOCAL_INDEX.version && old.revision===source.revision && old.epoch===epoch && old.pairs instanceof Blob && old.pairs.size===old.bytes && old.bytes>0 && old.bytes<=LOCAL_INDEX.marks*8){const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await old.pairs.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');current=digest===old.digest;}
          controller.signal.throwIfAborted();
          if(!current){const marks=await this.decoder.analyze(source.blob,this.worker,{signal:controller.signal,onProgress:value=>{if(owns())this.patch({kind:value.kind,progress:value.progress},{throttle:true});}});controller.signal.throwIfAborted();if(!await this.index.save(song.id,source.revision,marks,{signal:controller.signal,epoch}))throw new Error(tr("Audio changed. This result was not saved"));}
        }catch(error){controller.signal.throwIfAborted();if(error.code==='index-changed' || this.decoder.pending)throw error;this.state={...this.state,failed:this.state.failed+1};}
        if(owns())this.patch({done:this.state.done+1,progress:0},{throttle:true});
      }
      if(owns())this.patch({building:false,kind:'',title:'',notice:songs.length?(this.state.failed?tr("Update complete，{0} tracks could not be analyzed", this.state.failed):tr("Local fingerprint index updated")):tr("Import or download music first")});await this.refresh();return true;
    }catch(error){if(owns())this.patch({building:false,kind:'',error:error.message || tr("Index update incomplete")});return false;}
    finally{if(this.controller===controller){this.controller=null;if(this.state.building)this.patch({building:false,kind:''});this.worker.close();}}
  }
  cancel(message=tr("Paused. Completed index entries are kept")){
    ++this.sequence;this.controller?.abort(new DOMException(tr("Local fingerprint task cancelled"),'AbortError'));this.controller=null;this.worker.close();if(this.state.building)this.patch({building:false,kind:'',notice:message});
  }
  playbackIntent(){if(this.decoder.captureActive)this.cancel(tr("Playback resumed. Segment sampling paused"));}
  async clear(){this.cancel();await this.index.clear();this.patch({notice:tr("Local fingerprints cleared. You can rebuild them"),done:0,total:0,failed:0,title:'',error:''});await this.refresh();}
  dispose(){this.cancel();this.disposed=true;clearTimeout(this.notifyTimer);}
}

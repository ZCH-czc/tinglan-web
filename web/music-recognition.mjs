import {recognitionSong,recognitionPage} from './recognition-data.mjs';
const busyPhases=new Set(['permission','listening','fingerprinting','matching','local-matching']);
/** Latest user intent owns input, worker, request and durable history writes. There is no automatic retry. */
export class MusicRecognition {
  constructor({capture,fingerprint,history,match,localMatch,mode='auto',changed=()=>{},prepare=()=>{},remember=()=>{},now=Date.now}={}) {
    Object.assign(this,{capture,fingerprint,history,match,localMatch,changed,prepare,remember,now});this.mode=['auto','online','offline'].includes(mode)?mode:'auto';this.sequence=0;this.readSequence=0;this.rows=[];this.query='';this.page=0;this.state={phase:'idle',progress:0,error:'',notice:'',result:null};
  }
  get busy(){return busyPhases.has(this.state.phase);}
  patch(value){this.state={...this.state,...value};this.cachedView=null;this.changed();}
  view(){if(!this.cachedView){const history=recognitionPage(this.rows,this.query,this.page);this.cachedView={...this.state,mode:this.mode,busy:this.busy,query:this.query,history:history.items.map(row=>({...row,date:new Date(row.recognizedAt).toLocaleString('en-US',{dateStyle:'short',timeStyle:'short'})})),historyCount:this.rows.length,count:history.count,page:history.page,pages:history.pages};}return this.cachedView;}
  setMode(mode){if(!['auto','online','offline'].includes(mode))return;this.cancel();this.mode=mode;this.patch({error:'',notice:''});}
  async open(){const read=++this.readSequence;try{const rows=await this.history.list();if(read!==this.readSequence)return;this.rows=rows;for(const row of rows)this.remember(row);this.cachedView=null;this.changed();}catch{if(read===this.readSequence)this.patch({notice:'Recognition history unavailable. New recognition still works'});}}
  filter(query,page=0){this.query=String(query || '').slice(0,200);this.page=Math.max(0,Math.floor(Number(page)||0));this.cachedView=null;this.changed();}
  cancel(){++this.sequence;++this.readSequence;this.controller?.abort(new DOMException('Recognition cancelled','AbortError'));this.controller=null;if(this.busy)this.patch({phase:'idle',progress:0,error:'',notice:'Recognition cancelled'});}
  async start(file) {
    if(this.busy)return false;this.cancel();const sequence=++this.sequence,controller=new AbortController();this.controller=controller;const owns=()=>sequence===this.sequence && !controller.signal.aborted;
    this.patch({phase:file?'listening':'permission',progress:0,error:'',notice:'',result:null});
    try {
      this.prepare();const pcm=await this.capture.record({file,signal:controller.signal,onReady:()=>{if(owns())this.patch({phase:'listening'});},onProgress:progress=>{if(owns())this.patch({phase:'listening',progress});}});if(!owns())return false;
      let result;
      if(this.mode!=='online' && this.localMatch){this.patch({phase:'local-matching',progress:1});try{result=await this.localMatch(pcm,{signal:controller.signal,preserve:this.mode==='auto'});}catch(error){if(!owns())return false;if(this.mode==='offline')throw error;this.patch({notice:'Local matching unavailable. Continuing online'});}if(!owns())return false;}
      if(!result?.matched && this.mode!=='offline'){
        this.patch({phase:'fingerprinting',progress:1});const fingerprint=await this.fingerprint.run(pcm,{signal:controller.signal});if(!owns())return false;
        this.patch({phase:'matching'});result=await this.match(fingerprint,controller.signal);if(!owns())return false;
      }
      if(!result?.matched){this.patch({phase:'no-match'});return true;}
      const song=recognitionSong({...result.song,recognizedVia:result.origin==='local'?'local':'online'});this.remember(song);let notice='';
      try{await this.history.save(song,{signal:controller.signal,now:this.now()});if(!owns())return false;this.rows=await this.history.list();}catch(error){if(!owns())return false;notice='Track identified, but history could not be saved';}
      if(!owns())return false;this.page=0;this.query='';this.patch({phase:'result',result:song,notice});return true;
    }catch(error){if(!owns())return false;this.patch({phase:'error',error:error?.message || 'Recognition unavailable. Retry'});return false;}
    finally{if(this.controller===controller)this.controller=null;}
  }
  async clear(){this.cancel();const read=++this.readSequence;try{await this.history.clear();if(read!==this.readSequence)return;this.rows=[];this.page=0;this.query='';this.patch({notice:'Recognition history cleared'});}catch(error){if(read===this.readSequence)this.patch({notice:error?.message || 'Unable to clear history'});}}
  find(id){return this.state.result?.id===id?this.state.result:this.rows.find(row=>row.id===id);}
}

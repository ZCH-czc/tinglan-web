import {hostFetch} from './host-api.mjs';
import {LAN_LIMITS,audioFilename,lanTarget} from './lan-transfer-policy.mjs';

/** Raw File upload interoperates with Android; no account credentials or native visible controls. */
export class LanUploader {
  constructor({target,xhr=()=>new XMLHttpRequest(),fetcher=hostFetch,changed=()=>{},delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now}) {Object.assign(this,{target,xhr,fetcher,changed,delay,now});this.state={files:[],busy:false,progress:0,filename:'',completed:0,total:0,error:'',notice:''};this.epoch=0;}
  patch(value){this.state={...this.state,...value};this.changed(this.state);}
  select(files){if(this.state.busy)return;try{const accepted=Array.from(files).slice(0,LAN_LIMITS.rows);if(files.length>LAN_LIMITS.rows)throw new Error('Send at most 20 tracks');for(const file of accepted){audioFilename(file.name);if(!file.size || file.size>LAN_LIMITS.fileBytes)throw new Error('A track cannot be larger than 512 MB');}if(accepted.reduce((total,file)=>total+file.size,0)>LAN_LIMITS.pendingBytes)throw new Error('A batch cannot be larger than 1 GB，Send in smaller batches');this.files=accepted;this.patch({files:accepted.map(file=>({name:file.name,size:file.size})),total:accepted.length,completed:0,error:'',notice:''});}catch(error){this.files=[];this.patch({files:[],total:0,completed:0,error:error.message});throw error;}}
  async send() {
    if(this.state.busy || !this.files?.length)return false;const epoch=++this.epoch;this.controller=new AbortController();this.patch({busy:true,error:'',notice:'',completed:0});
    try {
      for(const [index,file] of this.files.entries()) {
        if(epoch!==this.epoch)return false;this.patch({filename:file.name,progress:0});
        const answer=await this.upload(file,epoch);
        if(answer?.receipt && answer.status!=='imported') {
          const deadline=this.now()+60000;
          while(epoch===this.epoch){if(this.now()>deadline)throw new Error('Files sent, but import is not complete. Check the receiving device');const response=await this.fetcher(this.target.origin+'/status?id='+encodeURIComponent(answer.receipt),{headers:{'X-Tinglan-Key':this.target.token},credentials:'omit',signal:this.controller.signal});let value;try{value=await response.json();}catch{throw new Error('Unable to read receiver status. Check the receiving device');}if(!response.ok)throw new Error(value.error?.message || 'The receiver has stopped');if(value.status==='imported')break;if(value.status==='failed')throw new Error(value.error || 'Import failed on the receiver. Retry there');await this.delay(1000);}
        }
        if(epoch!==this.epoch)return false;this.patch({completed:index+1,progress:1,notice:`Added to the receiving device ${index+1}/${this.files.length} tracks`});
      }return true;
    }catch(error){if(epoch===this.epoch)this.patch({error:error.name==='AbortError'?'Transfer cancelled':String(error.message || 'Connection lost. Check both devices’ local network').slice(0,180)});return false;}
    finally{if(epoch===this.epoch){this.active=null;this.patch({busy:false});}}
  }
  upload(file,epoch) {return new Promise((resolve,reject)=>{
    const xhr=this.xhr();this.active=xhr;xhr.open('POST',this.target.origin+'/upload?name='+encodeURIComponent(file.name));xhr.setRequestHeader('X-Tinglan-Key',this.target.token);xhr.timeout=LAN_LIMITS.uploadMs;let last=0;
    xhr.upload.onprogress=event=>{if(epoch===this.epoch && event.lengthComputable && this.now()-last>=150){last=this.now();this.patch({progress:Math.min(1,event.loaded/event.total)});}};
    xhr.onload=()=>{if(xhr.status!==200){let message=xhr.responseText;try{message=JSON.parse(message).error?.message || message;}catch{}reject(new Error(String(message).slice(0,180) || 'Transfer incomplete'));return;}let answer;try{answer=JSON.parse(xhr.responseText);}catch{}
      if(answer && /^[a-f0-9]{48}$/.test(answer.receipt || '') && ['pending','failed','imported'].includes(answer.status))resolve(answer);
      else if(xhr.responseText.trim()==='\u5df2\u63a5\u6536\uff1a'+audioFilename(file.name))resolve(null);
      else reject(new Error('The receiver did not confirm the music. Check there before retrying'));
    };
    xhr.onprogress=event=>{if(event.loaded>8192){reject(new Error('Unexpected receiver confirmation. Check the receiving device'));xhr.abort();}};
    xhr.onreadystatechange=()=>{if(xhr.readyState===2 && xhr.status>=400){const message=xhr.status===403 || xhr.status===410?'Invalid receiver code or session ended. Scan again':xhr.status===409?'The receiver is processing another track. Retry later':xhr.status===507?'Receiver staging space is full. Wait for imports to finish':'The receiver rejected this file. Check its format and size';reject(new Error(message));xhr.abort();}};
    xhr.onerror=()=>reject(new Error('Connection lost. Confirm both devices are on the same local network'));xhr.ontimeout=()=>reject(new Error('Transfer timed out. Send again'));xhr.onabort=()=>reject(new DOMException('Cancelled','AbortError'));xhr.send(file);
  });}
  cancel(){++this.epoch;this.controller?.abort();this.active?.abort();this.active=null;this.patch({busy:false,notice:'Transfer cancelled'});}
  view(){return {...this.state,files:this.state.files};}
}

if(typeof document!=='undefined' && document.documentElement.dataset.tinglanMode==='lan-sender') {
  let ui,uploader,warning='';
  const render=()=>ui?.updateUi(JSON.stringify({ready:true,page:'lan-sender',viewKey:'lan-sender',dark:matchMedia('(prefers-color-scheme: dark)').matches,transferSender:{...(uploader?.view() || {}),error:warning || uploader?.state.error || ''}}));
  async function start() {
    const module=await import('./ui/tinglan-web-ui.mjs');ui=module.updateUi?module:module.default;
    try{uploader=new LanUploader({target:lanTarget(location.href),changed:render});}catch(error){warning=error.message;}
    globalThis.tinglanDispatch=(action)=>{
      if(!uploader)return;
      if(action==='transfer-send')uploader.send();else if(action==='transfer-cancel')uploader.cancel();
      else if(action==='transfer-pick') {const input=document.createElement('input');input.type='file';input.multiple=true;input.accept='audio/*,.mp3,.m4a,.aac,.flac,.wav,.ogg,.opus,.aif,.aiff,.ape,.wma';input.hidden=true;input.addEventListener('change',()=>{try{uploader.select(Array.from(input.files || []));warning='';}catch(error){warning=error.message;}input.remove();render();},{once:true});input.addEventListener('cancel',()=>input.remove(),{once:true});document.body.append(input);input.click();}
    };
    window.addEventListener('pagehide',()=>uploader?.cancel());matchMedia('(prefers-color-scheme: dark)').addEventListener('change',render);render();document.getElementById('boot-canvas')?.remove();
  }
  start().catch(error=>globalThis.tinglanBootError?.(error.message));
}

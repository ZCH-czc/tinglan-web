import {RECOGNITION_LIMITS as L} from './recognition-data.mjs';
const abortError=()=>new DOMException('Recognition cancelled','AbortError');
const wait=(promise,signal,ms,message)=>new Promise((resolve,reject)=>{
  let timer;const done=(error,value)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);},abort=()=>done(signal.reason || abortError());
  if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>done(new Error(message)),ms);Promise.resolve(promise).then(value=>done(null,value),error=>done(error));
});
const stop=stream=>stream?.getTracks().forEach(track=>track.stop());
function metadata(audio,signal){return new Promise((resolve,reject)=>{
  const clean=()=>{audio.removeEventListener('loadedmetadata',ready);audio.removeEventListener('error',failed);signal.removeEventListener('abort',aborted);},ready=()=>{clean();resolve();},failed=()=>{clean();reject(new Error('The browser cannot read this audio. Use MP3、M4A or WAV'));},aborted=()=>{clean();reject(signal.reason || abortError());};
  audio.addEventListener('loadedmetadata',ready,{once:true});audio.addEventListener('error',failed,{once:true});signal.addEventListener('abort',aborted,{once:true});
  if(signal.aborted)aborted();else if(audio.readyState>=1)ready();
});}
export function validRecognitionFile(file){return file instanceof Blob && file.size>0 && file.size<=L.fileBytes && (/^audio\//i.test(file.type) || /\.(mp3|m4a|aac|ogg|opus|flac|wav|webm|mp4)$/i.test(file.name || ''));}
/** A temporary, finite input graph. Cancellation also stops permission grants arriving after cancellation. */
export class BrowserRecognitionCapture {
  constructor({Context=globalThis.AudioContext || globalThis.webkitAudioContext,Node=globalThis.AudioWorkletNode,devices=globalThis.navigator?.mediaDevices,createAudio=()=>document.createElement('audio'),urls=globalThis.URL}={}){Object.assign(this,{Context,Node,devices,createAudio,urls});}
  async record({file,signal,onReady=()=>{},onProgress=()=>{},seconds=6,startSeconds=0,analysis=false}) {
    signal.throwIfAborted();if(!this.Context || !this.Node)throw new Error('This browser does not support recognition audio processing');
    if(!Number.isFinite(seconds) || seconds<.128 || seconds>40 || !Number.isFinite(startSeconds) || startSeconds<0 || !file && (seconds!==6 || startSeconds!==0))throw new Error('Invalid audio capture range');
    if(file && !(analysis?file instanceof Blob && file.size>0 && file.size<=512*1024*1024:validRecognitionFile(file)))throw new Error(analysis?'Local analysis supports files up to 512 MB in size':'Choose a file no larger than 64 MB in size');
    if(!file && !this.devices?.getUserMedia)throw new Error('Microphone is unavailable here. Open using HTTPS or choose an audio file');
    let context;try{context=new this.Context({sampleRate:16000,latencyHint:'playback'});}catch{context=new this.Context();}
    let stream,node,source,audio,url,closed=false;const permissionAbort=new AbortController(),permissionSignal=AbortSignal.any([signal,permissionAbort.signal]);
    const release=()=>{if(closed)return;closed=true;permissionAbort.abort(abortError());stop(stream);if(node){node.port.onmessage=null;node.onprocessorerror=null;node.disconnect();node.port.close();}source?.disconnect();if(audio){audio.pause();audio.removeAttribute('src');audio.load();}if(url)this.urls.revokeObjectURL(url);void context.close().catch(()=>{});};
    const cancelled=()=>release();signal.addEventListener('abort',cancelled,{once:true});
    try {
      // Both calls begin in the user's gesture before waiting for permission or module loading.
      const resumed=context.resume();let permission;
      if(!file){permission=this.devices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});permission.then(value=>{if(closed || signal.aborted)stop(value);},()=>{});}
      await wait(resumed,permissionSignal,3000,'Audio processing has not started. Tap Start again');if(context.state!=='running')throw new Error('The browser has not allowed audio processing. Tap Start again');
      if(!file)stream=await wait(permission,permissionSignal,30000,'Microphone authorization is pending. Confirm permission and restart');
      signal.throwIfAborted();await wait(context.audioWorklet.addModule(new URL('./recognition-worklet.mjs',import.meta.url)),permissionSignal,10000,'Recognition component timed out. Retry');signal.throwIfAborted();
      node=new this.Node(context,'tinglan-recognition-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],processorOptions:{seconds}});node.connect(context.destination);
      if(file){audio=this.createAudio();audio.preload='metadata';audio.setAttribute('aria-hidden','true');url=this.urls.createObjectURL(file);audio.src=url;const loaded=metadata(audio,permissionSignal);audio.load();await wait(loaded,permissionSignal,8000,'Audio metadata read timed out');
        if(!Number.isFinite(audio.duration) || audio.duration+.001<startSeconds+seconds)throw new Error(analysis?'Insufficient audio duration for analysis':'Choose audio at least six seconds long');
        if(startSeconds){await wait(new Promise((resolve,reject)=>{const clean=()=>{audio.removeEventListener('seeked',seeked);audio.removeEventListener('error',failed);permissionSignal.removeEventListener('abort',abort);},seeked=()=>{clean();resolve();},failed=()=>{clean();reject(new Error('Unable to seek to the analysis position'));},abort=()=>{clean();reject(permissionSignal.reason || abortError());};audio.addEventListener('seeked',seeked,{once:true});audio.addEventListener('error',failed,{once:true});permissionSignal.addEventListener('abort',abort,{once:true});try{audio.currentTime=startSeconds;}catch(error){clean();reject(error);}}),permissionSignal,8000,'Seeking timed out');}
        source=context.createMediaElementSource(audio);
      }else source=context.createMediaStreamSource(stream);
      source.connect(node);signal.throwIfAborted();
      const completed=new Promise((resolve,reject)=>{node.onprocessorerror=()=>reject(new Error('Audio capture interrupted. Retry'));node.port.onmessage=({data})=>{if(closed || signal.aborted)return;if(data.error)reject(new Error(data.error));else if(data.samples instanceof Float32Array)resolve({samples:data.samples,rate:data.rate});else if(Number.isFinite(data.progress))onProgress(Math.min(1,Math.max(0,data.progress)));};});
      completed.catch(()=>{});
      if(audio)await wait(audio.play(),permissionSignal,4000,'The browser has not allowed audio access. Choose the file again');
      signal.throwIfAborted();onReady();node.port.postMessage('start');return await wait(completed,permissionSignal,seconds*1000+6000,'Audio capture timed out. Check the source and retry');
    }catch(error){if(signal.aborted)throw signal.reason || abortError();const messages={NotAllowedError:file?'The browser blocked audio access. Tap Choose audio again':'Microphone permission denied. Enable it in browser permissions or choose a file',NotFoundError:'No microphone found. Connect one or choose an audio file',NotReadableError:'Microphone is busy. Close the app using it and retry'};throw new Error(messages[error?.name] || error?.message || 'Audio capture failed. Retry');}
    finally{signal.removeEventListener('abort',cancelled);release();}
  }
}
export async function localFileDuration(file,{signal,createAudio=()=>document.createElement('audio'),urls=URL}={}){
  const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal,audio=createAudio(),url=urls.createObjectURL(file);audio.preload='metadata';audio.src=url;
  try{const loaded=metadata(audio,combined);audio.load();await wait(loaded,combined,8000,'Audio metadata read timed out');if(!Number.isFinite(audio.duration) || audio.duration<2)throw new Error('Track is too short or duration is unavailable');return audio.duration;}
  finally{controller.abort();audio.pause();audio.removeAttribute('src');audio.load();urls.revokeObjectURL(url);}
}
export class BrowserFingerprint {
  constructor({WorkerClass=globalThis.Worker,timeout=10000}={}){this.WorkerClass=WorkerClass;this.timeout=timeout;}
  run({samples,rate},{signal}={}){return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(signal.reason || abortError());return;}const worker=new this.WorkerClass(new URL('./recognition-worker.mjs',import.meta.url),{type:'module'});let timer;
    const done=(error,value)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();error?reject(error):resolve(value);},abort=()=>done(signal.reason || abortError());
    signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>done(new Error('Fingerprint calculation timed out. Retry')),this.timeout);
    worker.onmessage=({data})=>{if(data.error)done(new Error(data.error));else if(typeof data.fingerprint==='string' && data.fingerprint.length<=87384)done(null,data.fingerprint);};worker.onerror=()=>done(new Error('Fingerprint calculation unavailable. Update the page and retry'));worker.onmessageerror=()=>done(new Error('Unable to read fingerprint result'));
    try{worker.postMessage({samples,rate},[samples.buffer]);}catch(error){done(error);}
  });}
}

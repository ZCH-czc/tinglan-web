import {LOCAL_INDEX,indexWindows} from './local-index-data.mjs';
import {BrowserRecognitionCapture,localFileDuration} from './recognition-capture.mjs';
import {combineMarks} from './local-index-codec.mjs';
const abortError=()=>new DOMException('Local fingerprint task cancelled','AbortError');
function until(promise,signal,timeout,message){return new Promise((resolve,reject)=>{const finish=(error,value)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);},abort=()=>finish(signal.reason || abortError()),timer=setTimeout(()=>finish(new Error(message)),timeout);if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(v=>finish(null,v),finish);});}
/** Native offline decode is serialized even after UI cancellation; it has no browser abort API. */
export class LocalIndexDecoder {
  constructor({OfflineContext=globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext,capture=new BrowserRecognitionCapture(),duration=localFileDuration,changed=()=>{},beforeCapture=()=>{}}={}){Object.assign(this,{OfflineContext,capture,duration,changed,beforeCapture});this.pending=null;this.captureActive=false;}
  async offline(file,signal){
    if(this.pending)throw new Error('The previous track is still releasing. Retry shortly');
    const work=(async()=>{const context=new this.OfflineContext(1,1,16000),bytes=await file.arrayBuffer();signal.throwIfAborted();return context.decodeAudioData(bytes);})();this.pending=work;this.changed();
    work.then(()=>{},()=>{}).finally(()=>{if(this.pending===work){this.pending=null;this.changed();}});
    return until(work,signal,45000,'Offline decoding timed out. Continue later');
  }
  async analyze(file,worker,{signal,onProgress=()=>{}}={}) {
    signal.throwIfAborted();let metadata;
    try{metadata=await worker.run('inspect',file,{signal});}catch(error){signal.throwIfAborted();metadata={seconds:0,channels:0};}
    const expected=metadata.seconds*metadata.channels*16000*4,fast=!!this.OfflineContext && file.size<=LOCAL_INDEX.decodeBytes && metadata.seconds>=2 && metadata.channels>=1 && metadata.channels<=8 && expected<=LOCAL_INDEX.decodedBytes;
    let audio;
    if(fast)try{onProgress({kind:'decoding',progress:0});audio=await this.offline(file,signal);signal.throwIfAborted();if(audio.sampleRate!==16000 || audio.numberOfChannels>8 || audio.length*audio.numberOfChannels*4>LOCAL_INDEX.decodedBytes)throw new Error('Decoded track exceeds the analysis memory limit');}catch(error){signal.throwIfAborted();if(this.pending)throw error;audio=null;}
    const seconds=audio?audio.duration:await this.duration(file,{signal}),windows=indexWindows(seconds),marks=[];
    for(let i=0;i<windows.length;i++){
      signal.throwIfAborted();const window=windows[i];let channels,rate;
      if(audio){rate=16000;const start=Math.floor(window.startMs*16),length=Math.min(Math.floor(window.seconds*16000),audio.length-start);channels=Array.from({length:audio.numberOfChannels},(_,c)=>{const values=new Float32Array(length);audio.copyFromChannel(values,c,start);return values;});}
      else {
        this.beforeCapture();this.captureActive=true;this.changed();
        try{const pcm=await this.capture.record({file,signal,analysis:true,seconds:window.seconds,startSeconds:window.startMs/1000,onProgress:p=>onProgress({kind:'sampling',progress:(i+p)/windows.length})});channels=[pcm.samples];rate=pcm.rate;}
        finally{this.captureActive=false;this.changed();}
      }
      const result=await worker.run('extract',{channels,rate,frameOffset:window.frameOffset},{signal,transfer:channels.map(c=>c.buffer)});if(result.byteLength)marks.push(result);onProgress({kind:'analyzing',progress:(i+1)/windows.length});
    }
    return combineMarks(marks);
  }
}

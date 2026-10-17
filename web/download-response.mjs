import {hasAudioHeader} from './lan-transfer-policy.mjs';
const formats=['mp3','m4a','aac','flac','wav','ogg','opus','aiff','ape','wma'];
export async function downloadAudio(response,{signal,limit=512*1048576,type='',progress=()=>{}}={}) {
  let total=Number(response.headers.get('content-length')) || 0;
  type=(response.headers.get('content-type') || type).split(';')[0];
  // Some media CDNs return 206 for a complete file even without a Range request.
  // Only accept it when Content-Range proves that every byte is included.
  const range=/^bytes 0-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
  const completeRange=response.status===206 && range && Number(range[1])+1===Number(range[2]) && Number(range[2])>0 && (!total || total===Number(range[2]));
  if(completeRange)total=Number(range[2]);
  const error=total>limit?'Audio exceeds download space limit':!response.body?'Download returned no audio':response.status!==200 && !completeRange?`Download returned incomplete audio（HTTP ${response.status}），Please retry`:!/^(?:audio\/[a-z0-9.+-]+|application\/(?:octet-stream|ogg)|video\/mp4)$/i.test(type)?`Downloaded format is unsupported（${type.slice(0,60) || 'Unknown format'}）`:'';
  if(error){await response.body?.cancel().catch(()=>{});throw new Error(error);}
  let done=0;const reader=response.body.getReader();
  const stop=()=>reader.cancel(signal.reason).catch(()=>{});signal?.addEventListener('abort',stop,{once:true});
  try {
    const body=new ReadableStream({async pull(controller){try{signal?.throwIfAborted();const part=await reader.read();signal?.throwIfAborted();if(part.done){controller.close();return;}done+=part.value.byteLength;if(done>limit)throw new Error('Audio exceeds download space limit');progress(done,total);controller.enqueue(part.value);}catch(error){await reader.cancel(error).catch(()=>{});controller.error(error);}},cancel:reason=>reader.cancel(reason)},{highWaterMark:1});
    const blob=await new Response(body,{headers:{'Content-Type':type}}).blob();signal?.throwIfAborted();
    if(!done || total && total!==done)throw new Error('Music download incomplete. Retry');
    const head=await blob.slice(0,64).arrayBuffer();if(!formats.some(ext=>hasAudioHeader('audio.'+ext,head)))throw new Error('Downloaded content is not supported audio');
    return blob;
  }finally{signal?.removeEventListener('abort',stop);reader.releaseLock();}
}

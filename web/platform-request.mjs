import {tr} from './i18n.mjs';
import {hostFetch,hostSetTimeout,hostClearTimeout} from './host-api.mjs';
import {retryAfterSeconds} from './playback-recovery.mjs';

// The companion normalizes platform replies before they reach this transport.
// Audio, images and backups use their own streaming paths.
export const PLATFORM_JSON_LIMIT=8*1024*1024;

function failure(message,code,response,name='Error') {
  return Object.assign(new Error(message),{name,code,status:response?.status || 0,retryAfter:retryAfterSeconds(response?.headers?.get('retry-after'))});
}
function connectionFailure(method,timedOut=false) {
  const readOnly=['GET','HEAD'].includes(method);
  const message=readOnly
    ?(timedOut?tr("Music service timed out. Tap Retry later."):tr("Local companion connection lost. Confirm Tinglan’s companion is running, then retry."))
    :(timedOut?tr("Connection timed out; the action is unconfirmed. Refresh status before submitting again."):tr("Connection lost; the action is unconfirmed. Refresh status before submitting again."));
  return failure(message,'network',null,timedOut?'TimeoutError':'Error');
}
function invalidReply(response) {
  return failure(tr("Unrecognized companion response. Start the matching Tinglan companion version."),'invalid-response',response);
}

/** One deadline owns headers and body; cancellation also settles adapters that ignore AbortSignal.
 * A late reply is discarded. No request, including a mutation, is automatically retried here. */
export async function requestPlatformJson(path,{
  signal,method='GET',body,timeoutMs=18_000,fetcher=hostFetch,
  setTimer=hostSetTimeout,clearTimer=hostClearTimeout,
}={}) {
  signal?.throwIfAborted();
  if(!Number.isFinite(timeoutMs) || timeoutMs<0)throw new RangeError('Invalid platform request timeout');
  method=method.toUpperCase();
  const options={method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined};
  const controller=new AbortController();
  let response,reader,timer,rejectCancellation;
  const cancelled=new Promise((_,reject)=>{rejectCancellation=reject;});
  const discardBody=()=>{
    try {Promise.resolve(reader?reader.cancel(controller.signal.reason):response?.body?.cancel(controller.signal.reason)).catch(()=>{});}catch{/* Already released or closed. */}
  };
  const stop=reason=>{
    if(controller.signal.aborted)return;
    controller.abort(reason);discardBody();rejectCancellation(reason);
  };
  const callerAborted=()=>stop(signal.reason);
  signal?.addEventListener('abort',callerAborted,{once:true});
  timer=setTimer(()=>stop(connectionFailure(method,true)),timeoutMs);

  const operation=(async()=>{
    try {response=await fetcher(path,{...options,signal:controller.signal});}
    catch {controller.signal.throwIfAborted();throw connectionFailure(method);}
    if(controller.signal.aborted){discardBody();controller.signal.throwIfAborted();}
    let text;
    try {
      const advertised=Number(response.headers.get('content-length'));
      if(advertised>PLATFORM_JSON_LIMIT)throw failure(tr("Companion response is too large. Narrow the request and retry."),'invalid-response',response);
      reader=response.body?.getReader();
      const parts=[],decoder=new TextDecoder('utf-8',{fatal:true});let size=0;
      if(reader)while(true){
        let chunk;
        try {chunk=await reader.read();}catch{controller.signal.throwIfAborted();throw connectionFailure(method);}
        controller.signal.throwIfAborted();if(chunk.done)break;
        size+=chunk.value.byteLength;
        if(size>PLATFORM_JSON_LIMIT)throw failure(tr("Companion response is too large. Narrow the request and retry."),'invalid-response',response);
        try {parts.push(decoder.decode(chunk.value,{stream:true}));}catch{throw invalidReply(response);}
      }
      try {parts.push(decoder.decode());}catch{throw invalidReply(response);}
      text=parts.join('');
    }catch(error){discardBody();throw error;}
    finally{reader?.releaseLock();reader=null;}
    controller.signal.throwIfAborted();
    let value;try{value=JSON.parse(text);}catch{throw invalidReply(response);}
    if(!response.ok){
      const message=typeof value?.error?.message==='string'?value.error.message.slice(0,600):tr("Platform connection unavailable. Retry later.");
      throw failure(message,typeof value?.error?.code==='string'?value.error.code:'unavailable',response);
    }
    if(!value || typeof value!=='object')throw invalidReply(response);
    return value;
  })();
  try{return await Promise.race([operation,cancelled]);}
  finally{clearTimer(timer);signal?.removeEventListener('abort',callerAborted);}
}

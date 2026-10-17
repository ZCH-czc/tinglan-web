import {hostSetTimeout,hostClearTimeout} from './host-api.mjs';

/** A controller-owned deadline also settles adapters that ignore AbortSignal. Late values cannot
 * become audible, and abort/deadline listeners are released for every outcome. */
export function playbackTask(operation,{signal,timeoutMs,timers={setTimeout:hostSetTimeout,clearTimeout:hostClearTimeout},code='source-timeout'}={}) {
  if(signal?.aborted)return Promise.reject(signal.reason || new DOMException('Cancelled','AbortError'));
  return new Promise((resolve,reject)=>{
    let settled=false,timer;
    const finish=(callback,value)=>{if(settled)return;settled=true;if(timer!=null)timers.clearTimeout(timer);signal?.removeEventListener('abort',cancel);callback(value);};
    const cancel=()=>finish(reject,signal.reason || new DOMException('Cancelled','AbortError'));
    signal?.addEventListener('abort',cancel,{once:true});
    if(timeoutMs>0){timer=timers.setTimeout(()=>finish(reject,Object.assign(new Error(code==='source-timeout'?'Music loading timed out. Check your connection':'Connection check timed out'),{code})),timeoutMs);timer?.unref?.();}
    try{Promise.resolve(operation()).then(value=>finish(resolve,value),error=>finish(reject,error));}catch(error){finish(reject,error);}
  });
}

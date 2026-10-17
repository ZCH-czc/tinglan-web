import {fingerprintPcm} from './recognition-pcm.mjs';
const HASH='8064415bb66e45410e88877f07cd007a3ae62ebf463aac13c159a8f13e4c8fe8';
self.onmessage=async({data})=>{
  let vector;
  try {
    const pcm=fingerprintPcm(data.samples,data.rate);
    self.postMessage({phase:'fingerprinting'});
    const response=await fetch(new URL('./recognition/afp.wasm',import.meta.url),{credentials:'omit'});if(!response.ok)throw new Error('Fingerprint engine not ready. Update the page and retry');
    const bytes=await response.arrayBuffer(),digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');if(digest!==HASH)throw new Error('Fingerprint engine verification failed');
    const {createNeteaseAfp}=await import('./recognition/afp-bindings.mjs');
    const afp=await new Promise((resolve,reject)=>{createNeteaseAfp({wasmBinary:new Uint8Array(bytes),print:()=>{},printErr:()=>{},onAbort:()=>reject(new Error('Fingerprint engine failed')),onRuntimeInitialized:function(){resolve(this);}});});
    vector=afp.ExtractQueryFP(pcm.buffer);const size=vector.size();if(size<1 || size>65536)throw new Error('Invalid fingerprint length');
    let raw='';for(let i=0;i<size;i++)raw+=String.fromCharCode(vector.get(i)&255);self.postMessage({fingerprint:btoa(raw)});
  }catch(error){self.postMessage({error:error?.message || 'Audio processing failed. Retry'});}finally{vector?.delete();}
};

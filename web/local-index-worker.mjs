import {tr} from './i18n.mjs';
import {parseBlob} from 'music-metadata';
import {LibraryStore} from './storage.mjs';
import {LocalIndexStore} from './local-index-storage.mjs';
import {matchLocalIndex} from './local-index-match.mjs';
import {localPcm,encodeBytes,decodeBytes} from './local-index-codec.mjs';
let core;
async function domain(){if(!core){const module=await import(new URL('./engine/tinglan-web-core.mjs',import.meta.url).href);core=module.localFingerprintExtract?module:module.default;}return core;}

self.onmessage=async({data})=>{
  try {let result;
    if(data.operation==='inspect'){const {format}=await parseBlob(data.input,{duration:true,skipCovers:true,skipPostHeaders:false,maxBufferSize:8*1024*1024});result={seconds:Number(format.duration)||0,channels:Number(format.numberOfChannels)||0,rate:Number(format.sampleRate)||0};}
    else if(data.operation==='extract'){const engine=await domain(),encoded=engine.localFingerprintExtract(encodeBytes(localPcm(data.input.channels,data.input.rate)),data.input.frameOffset);result=decodeBytes(encoded).buffer;}
    else if(data.operation==='match'){const store=new LibraryStore();await store.open();try{result=await matchLocalIndex(await domain(),new LocalIndexStore(store),data.input,progress=>self.postMessage({id:data.id,progress}));}finally{store.db.close();}}
    else throw new Error(tr("Unknown local fingerprint action"));
    self.postMessage({id:data.id,result},result instanceof ArrayBuffer?[result]:[]);
  }catch(error){self.postMessage({id:data.id,error:/[\u4e00-\u9fff]/.test(error?.message || '')?error.message:tr("Fingerprint analysis incomplete. Retry")});}
};

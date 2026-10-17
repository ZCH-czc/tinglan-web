import {tr} from './i18n.mjs';
import {WorkerClient} from './worker-client.mjs';
export class LocalIndexWorker {
  constructor({client=new WorkerClient(new URL('./local-index-worker.mjs',import.meta.url),{timeout:45000,idleMs:30000})}={}){this.client=client;this.sequence=0;}
  async run(operation,input,{signal,onProgress=()=>{},transfer=[]}={}) {
    signal?.throwIfAborted();const sequence=++this.sequence,abort=()=>{if(this.sequence===sequence)this.close();};signal?.addEventListener('abort',abort,{once:true});
    try{const value=await this.client.run(operation,input,onProgress,{transfer});signal?.throwIfAborted();return value;}catch(error){signal?.throwIfAborted();throw new Error(error?.message?.includes(tr("File parsing timed out"))?tr("Fingerprint analysis timed out. Task paused; continue later"):error.message);}finally{signal?.removeEventListener('abort',abort);}
  }
  close(){++this.sequence;this.client.close(tr("Local fingerprint task cancelled"));}
}
export class LocalIndexMatcher {
  constructor(index,{worker=new LocalIndexWorker()}={}){this.index=index;this.worker=worker;this.sequence=0;}
  async match(pcm,{signal,preserve=false,onProgress}={}){
    signal?.throwIfAborted();const sequence=++this.sequence;this.worker.close();const current=()=>{signal?.throwIfAborted();if(sequence!==this.sequence)throw new DOMException(tr("Local matching cancelled"),'AbortError');};
    try{if(!(await this.index.info()).count){current();return {matched:false,origin:'local'};}current();const samples=preserve?pcm.samples.slice():pcm.samples,result=await this.worker.run('match',{samples,rate:pcm.rate},{signal,onProgress,transfer:[samples.buffer]});current();
      if(result.matched){const song=await this.index.resolve(result.id,result.revision,{signal,epoch:result.epoch});current();return song?{...result,song}:{matched:false,origin:'local'};}return result;
    }finally{if(sequence===this.sequence)this.worker.close();}
  }
  close(){++this.sequence;this.worker.close();}
}

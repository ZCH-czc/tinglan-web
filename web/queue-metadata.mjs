/** Keep persistence concurrency bounded even when the user rapidly replaces a large playback queue. */
export class QueueMetadataSaver {
  constructor(save,complete=()=>{},{concurrency=4}={}) {
    this.save=save;this.complete=complete;this.concurrency=Math.max(1,Math.min(16,concurrency));this.running=new Map();this.clear();
  }
  select(ids) {
    this.pending=[...new Set(ids)];this.wanted=new Set(this.pending);this.failures=new Set();this.notified=false;this.pump();
  }
  clear(){this.pending=[];this.wanted=new Set();this.failures=new Set();this.notified=true;}
  pump() {
    while(this.running.size<this.concurrency && this.pending.length) {
      const id=this.pending.shift();if(this.running.has(id))continue;
      const task=Promise.resolve().then(()=>this.save(id));this.running.set(id,task);
      task.catch(()=>{if(this.wanted.has(id))this.failures.add(id);}).finally(()=>{this.running.delete(id);this.pump();});
    }
    if(!this.notified && !this.pending.length && ![...this.running.keys()].some(id=>this.wanted.has(id))) {this.notified=true;this.complete([...this.failures]);}
  }
}

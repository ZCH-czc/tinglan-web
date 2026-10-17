import {tr} from './i18n.mjs';
/** Requests and retained data follow the video identity, never the animation frame rate. */
export class DanmakuSession {
  constructor(load,changed,failed) {Object.assign(this,{load,changed,failed});this.id='';this.items=[];this.revision=0;this.cache=new Map();}
  async select(id,enabled) {
    if(!enabled || !id){this.abort?.abort();this.abort=null;++this.revision;this.id='';this.items=[];this.changed(this.items);return;}
    if(this.id===id && (this.items.length || this.abort))return;
    const revision=++this.revision;this.abort?.abort();this.abort=new AbortController();this.id=id;this.items=[];this.changed(this.items);
    try {
      const data=this.cache.get(id) || await this.load(id,this.abort.signal);if(revision!==this.revision)return;
      this.items=data.items || [];this.cache.delete(id);this.cache.set(id,data);while(this.cache.size>4)this.cache.delete(this.cache.keys().next().value);this.changed(this.items);
    }catch(error){if(revision===this.revision && error.name!=='AbortError')this.failed(error.message || tr("Scrolling comments have not loaded. Video can continue"));}
    finally {if(revision===this.revision)this.abort=null;}
  }
  clear(){this.select('',false);this.cache.clear();}
}

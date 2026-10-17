import {parseBilibiliId} from './bilibili-id.mjs';

const nonce=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),byte=>byte.toString(16).padStart(2,'0')).join('');
const initial=id=>({id,bvid:parseBilibiliId(id.slice(5))?.bvid || '',title:'',loaded:false,loading:false,busy:false,liked:false,folders:[],warning:'',notice:'',needsRefresh:false,needsLogin:false});
function accepted(value,bvid) {
  if(value?.bvid!==bvid || !/^[a-f0-9]{32}$/.test(value.token || '') || typeof value.liked!=='boolean' || !Array.isArray(value.folders) || value.folders.length>500)throw new Error('Invalid video action status. Update the companion');
  const seen=new Set();
  for(const row of value.folders){if(!/^[1-9]\d{0,18}$/.test(row?.id || '') || seen.has(row.id) || typeof row.selected!=='boolean' || typeof row.title!=='string')throw new Error('Invalid collection list');seen.add(row.id);}
  return {...value,folders:value.folders.map(row=>({...row,checked:row.selected})),loaded:true,loading:false,busy:false,warning:'',notice:value.notice || '',needsRefresh:!!value.needsRefresh,needsLogin:false};
}

/** Retained dialog state. Closing a dialog cannot silently repeat or undo a submitted action. */
export class VideoActions {
  constructor({platform,changed=()=>{},now=Date.now,operationId=nonce}) {Object.assign(this,{platform,changed,now,operationId});this.cache=new Map();this.active=null;this.read=null;this.revision=0;this.state=initial('');}
  current(entry) {return this.cache.get(entry.key)===entry && entry.account===this.platform.accountRevision && entry.generation===this.platform.generation;}
  publish(entry) {if(this.active===entry && this.current(entry)){this.state={...entry.value,id:entry.id};this.changed(this.state);}}
  patch(entry,value) {entry.value={...entry.value,...value};this.publish(entry);}
  prune() {while(this.cache.size>12){const old=[...this.cache].find(([,entry])=>entry!==this.active&&!entry.value.busy);if(!old)break;this.cache.delete(old[0]);}}
  async open(id,{force=false}={}) {
    if(typeof id!=='string' || !id.startsWith('bili-') || !parseBilibiliId(id.slice(5)))return;
    this.close();const revision=this.revision,bvid=parseBilibiliId(id.slice(5)).bvid,key=this.platform.accountRevision+':'+bvid;
    let entry=this.cache.get(key);
    if(!entry || !this.current(entry)){entry={id,key,account:this.platform.accountRevision,generation:this.platform.generation,value:initial(id),expiresAt:0};this.cache.set(key,entry);}
    entry.id=id;this.active=entry;this.prune();
    if(entry.value.busy || entry.value.loaded && !force && !entry.value.needsRefresh && entry.expiresAt>this.now()){this.publish(entry);return;}
    const controller=new AbortController();this.read=controller;this.patch(entry,{loading:true,warning:'',notice:''});
    try {
      const value=await this.platform.videoActions(id,{force:force || entry.value.needsRefresh,signal:controller.signal});controller.signal.throwIfAborted();
      if(revision!==this.revision || !this.current(entry))return;
      entry.value={...accepted(value,bvid),id,bvid};entry.expiresAt=this.now()+300000;this.publish(entry);
    }catch(error){if(revision!==this.revision || !this.current(entry) || error.name==='AbortError')return;this.patch(entry,{loading:false,needsRefresh:true,needsLogin:error.code==='sign-in',warning:error.message || 'Video actions temporarily unavailable'});}
    finally {if(this.read===controller)this.read=null;}
  }
  choose(id) {
    const entry=this.active;if(!entry || entry.value.busy || entry.value.loading || !entry.value.loaded || entry.value.needsRefresh)return;
    this.patch(entry,{notice:'',folders:entry.value.folders.map(row=>row.id===id?{...row,checked:!row.checked}:row)});
  }
  like() {const entry=this.active;return this.submit('like',{liked:!entry?.value.liked});}
  favorites() {const entry=this.active;return this.submit('favorites',{selected:entry?.value.folders.filter(row=>row.checked).map(row=>row.id) || []});}
  async submit(action,fields) {
    const entry=this.active;
    if(!entry || !this.current(entry) || !entry.value.loaded || entry.value.loading || entry.value.busy || entry.value.needsRefresh)return false;
    if(entry.expiresAt<=this.now()){this.patch(entry,{needsRefresh:true,warning:'Video action status expired. Refresh and check likes and collections'});return false;}
    if(action==='favorites' && entry.value.folders.every(row=>row.selected===row.checked)){this.patch(entry,{notice:'Collections unchanged'});return true;}
    const draft=new Set(entry.value.folders.filter(row=>row.checked).map(row=>row.id)),input={action,...fields,token:entry.value.token,operation:this.operationId()};
    this.patch(entry,{busy:true,warning:'',notice:''});
    try {
      const value=await this.platform.videoAction(entry.id,input);if(!this.current(entry))return false;
      const result=accepted(value,entry.value.bvid);
      if(action==='like')result.folders=result.folders.map(row=>({...row,checked:draft.has(row.id)}));
      entry.value={...result,id:entry.id};entry.expiresAt=this.now()+300000;this.publish(entry);return true;
    }catch(error){if(!this.current(entry) || error.name==='AbortError')return false;const message=error.message || 'Connection temporarily unavailable';this.patch(entry,{busy:false,needsRefresh:true,needsLogin:error.code==='sign-in',warning:error.code==='sign-in' || message.includes('Unconfirmed')?message:`Action not confirmed. Refresh to verify. ${message}`});return false;}
  }
  close() {++this.revision;this.read?.abort();this.read=null;if(this.active?.value.loading)this.active.value={...this.active.value,loading:false,needsRefresh:true};this.active=null;this.state=initial('');this.changed(this.state);}
  clear() {this.close();this.cache.clear();}
}

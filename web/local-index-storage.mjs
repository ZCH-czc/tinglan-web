import {tr} from './i18n.mjs';
import {LOCAL_INDEX,indexEligible,validateMarks} from './local-index-data.mjs';
import {validId} from './library-data.mjs';
import {mediaRevisionKey} from './media-identity.mjs';
const EPOCH='local-index-epoch';
/** Blob handles keep a 300-song scan from loading all landmark buffers into memory. */
export class LocalIndexStore {
  constructor(store){this.store=store;}
  async eligible(){return (await this.store.tracks()).filter(indexEligible).sort((a,b)=>(b.addedAt || 0)-(a.addedAt || 0) || a.id.localeCompare(b.id)).slice(0,LOCAL_INDEX.tracks);}
  async summaries(){return this.store.all('fingerprints');}
  async epoch(){let value;await this.store.write(['settings'],tx=>{const target=tx.objectStore('settings'),request=target.get(EPOCH);request.onsuccess=()=>{value=typeof request.result==='string'?request.result:crypto.randomUUID();if(!request.result)target.put(value,EPOCH);};});return value;}
  async info(){let count=0,bytes=0;await new Promise((resolve,reject)=>{const tx=this.store.db.transaction('fingerprints'),request=tx.objectStore('fingerprints').openCursor();request.onsuccess=()=>{const cursor=request.result;if(cursor){if(cursor.value.version===LOCAL_INDEX.version){count++;bytes+=Number(cursor.value.bytes)||0;}cursor.continue();}};tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error || new Error(tr("Unable to read fingerprint index")));});return {count,bytes};}
  async source(id,{signal}={}) {
    if(!validId(id))throw new Error(tr("Invalid audio identifier"));let result;
    await this.store.write(['tracks','media','settings'],tx=>{const t=tx.objectStore('tracks').get(id),m=tx.objectStore('media').get(id),v=tx.objectStore('settings').get(mediaRevisionKey(id)),e=tx.objectStore('settings').get(EPOCH);let pending=4;const done=()=>{if(--pending)return;if(!indexEligible(t.result) || !(m.result instanceof Blob) || !m.result.size)return;const revision=typeof v.result==='string'?v.result:crypto.randomUUID(),epoch=typeof e.result==='string'?e.result:crypto.randomUUID();if(!v.result)tx.objectStore('settings').put(revision,mediaRevisionKey(id));if(!e.result)tx.objectStore('settings').put(epoch,EPOCH);result={track:t.result,blob:m.result,revision,epoch};};t.onsuccess=m.onsuccess=v.onsuccess=e.onsuccess=done;},{signal});
    return result || null;
  }
  async save(id,revision,bytes,{signal,epoch}={}) {
    validateMarks(bytes);let accepted=false,failure;
    const data=new DataView(bytes),hashes=Uint32Array.from(new Set(Array.from({length:bytes.byteLength/8},(_,i)=>data.getUint32(i*8,true))));hashes.sort();
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');signal?.throwIfAborted();
    await this.store.write(['tracks','media','settings','fingerprints'],tx=>{
      const t=tx.objectStore('tracks').get(id),m=tx.objectStore('media').get(id),v=tx.objectStore('settings').get(mediaRevisionKey(id)),e=tx.objectStore('settings').get(EPOCH),count=tx.objectStore('fingerprints').count(),old=tx.objectStore('fingerprints').get(id);let pending=6;
      const done=()=>{if(--pending)return;if(!indexEligible(t.result) || !(m.result instanceof Blob) || v.result!==revision || e.result!==epoch)return;if(!old.result && count.result>=LOCAL_INDEX.tracks){failure=new Error(tr("Local fingerprints support up to 300 tracks. Update or clear the index"));tx.abort();return;}tx.objectStore('fingerprints').put({id,revision,epoch,version:LOCAL_INDEX.version,pairs:new Blob([bytes]),hashes,digest,marks:bytes.byteLength/8,bytes:bytes.byteLength,updatedAt:Date.now()},id);accepted=true;};t.onsuccess=m.onsuccess=v.onsuccess=e.onsuccess=count.onsuccess=old.onsuccess=done;
    },{signal}).catch(error=>{throw failure || error;});return accepted;
  }
  async resolve(id,revision,{signal,epoch}={}){const result=await this.source(id,{signal});return result?.revision===revision && result.epoch===epoch?result.track:null;}
  async prune(keep,{signal}={}){const ids=new Set(keep);await this.store.write(['fingerprints'],tx=>{const request=tx.objectStore('fingerprints').openKeyCursor();request.onsuccess=()=>{const cursor=request.result;if(cursor){if(!ids.has(cursor.primaryKey))tx.objectStore('fingerprints').delete(cursor.primaryKey);cursor.continue();}};},{signal});}
  clear({signal}={}){return this.store.write(['fingerprints','settings'],tx=>{tx.objectStore('fingerprints').clear();tx.objectStore('settings').put(crypto.randomUUID(),EPOCH);},{signal});}
}

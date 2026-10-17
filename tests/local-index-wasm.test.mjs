import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {LibraryStore} from '../web/storage.mjs';
import {LocalIndexStore} from '../web/local-index-storage.mjs';
import {matchLocalIndex} from '../web/local-index-match.mjs';
import {indexWindows} from '../web/local-index-data.mjs';
import {localPcm,encodeBytes,decodeBytes,combineMarks} from '../web/local-index-codec.mjs';
import {music,recording} from './local-index-fixtures.mjs';
const module=await import('../build/dist/engine/tinglan-web-core.mjs'),engine=module.localFingerprintExtract?module:module.default;
const extract=(samples,offset=0)=>decodeBytes(engine.localFingerprintExtract(encodeBytes(localPcm([samples],16000)),offset)).buffer;
const score=(q,r)=>engine.localFingerprintScore(encodeBytes(new Uint8Array(q)),encodeBytes(new Uint8Array(r))).split(',').map(Number);
async function fixture(){globalThis.indexedDB=new IDBFactory();const library=new LibraryStore();await library.open();return {library,index:new LocalIndexStore(library)};}
async function entry(library,index,id,bytes){await library.putTrack({id,source:'local',title:id,artist:'合成验收',addedAt:1,size:4,durationMs:120000},new Blob(['WAVE']));const s=await index.source(id);assert.equal(await index.save(id,s.revision,bytes,{epoch:s.epoch}),true);}
const pack=rows=>{const out=new Uint8Array(rows.length*8),v=new DataView(out.buffer);rows.forEach(([h,t],i)=>{v.setInt32(i*8,h,true);v.setInt32(i*8+4,t,true);});return out.buffer;};

test('production Wasm matches an offset, quieter noisy query against actual extracted landmarks',()=>{
  const original=music(18,7),q=extract(recording(original)),best=score(q,extract(original)),runner=score(q,extract(music(18,42)));
  assert(engine.localFingerprintAccepts(...best,...runner),JSON.stringify({best,runner}));assert.equal(engine.localFingerprintExtract(encodeBytes(new Uint8Array(96000*2)),0),'');assert.throws(()=>engine.localFingerprintExtract('AA==',0));
});
test('real local matching finds the middle window and ignores a corrupt independent candidate',async()=>{
  const {library,index}=await fixture();try{
    const original=music(120,7),landmarks=combineMarks(indexWindows(120).map(w=>extract(original.slice(w.startMs*16,(w.startMs*16)+w.seconds*16000),w.frameOffset)));
    await entry(library,index,'local-a',landmarks);await entry(library,index,'local-b',extract(music(18,42)));await library.write(['fingerprints'],tx=>{const r=tx.objectStore('fingerprints').get('local-b');r.onsuccess=()=>tx.objectStore('fingerprints').put({...r.result,digest:'corrupt'},'local-b');});
    const result=await matchLocalIndex(engine,index,{samples:recording(original,70.013),rate:16000});assert.equal(result.matched,true);assert.equal(result.song.id,'local-a');assert.equal(result.origin,'local');
  }finally{library.db.close();}
});
test('candidate pruning retains a one-hash runner and the actual native confidence policy rejects ambiguity',async()=>{
  const {library,index}=await fixture();try{
    const rows=[...Array.from({length:40},(_,i)=>[1,i]),...Array.from({length:20},(_,i)=>[2+i%11,i])],q=pack(rows);await entry(library,index,'local-best',q);await entry(library,index,'local-runner',pack(rows.filter(([h])=>h===1)));
    const [votes,frames,hashes]=score(q,q),runner=score(q,pack(rows.filter(([h])=>h===1)));assert.equal(votes,60);assert.equal(hashes,12);assert.equal(engine.localFingerprintAccepts(votes,frames,hashes,...runner),false);
    const controlled={localFingerprintExtract:()=>encodeBytes(new Uint8Array(q)),localFingerprintScore:engine.localFingerprintScore,localFingerprintAccepts:engine.localFingerprintAccepts};const result=await matchLocalIndex(controlled,index,{samples:new Float32Array(96000),rate:16000});assert.equal(result.matched,false);
  }finally{library.db.close();}
});
test('a final media replacement or index clear invalidates a match already scored inside the worker',async()=>{
  for(const change of ['replace','clear']){const {library,index}=await fixture();try{const original=music(12,7);await entry(library,index,'local-a',extract(original));const resolve=index.resolve.bind(index);index.resolve=async(...args)=>{if(change==='clear')await index.clear();else await library.putTrack({id:'local-a',source:'local',title:'replacement',size:4},new Blob(['NEW!']));return resolve(...args);};assert.equal((await matchLocalIndex(engine,index,{samples:recording(original,4),rate:16000})).matched,false);}finally{library.db.close();}}
});

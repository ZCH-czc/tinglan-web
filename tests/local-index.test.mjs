import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {LibraryStore} from '../web/storage.mjs';
import {CacheStore} from '../web/cache-storage.mjs';
import {LocalIndexStore} from '../web/local-index-storage.mjs';
import {LOCAL_INDEX,indexWindows,validateMarks,fingerprintTerms,voteBound,canChangeDecision} from '../web/local-index-data.mjs';
import {localPcm,combineMarks} from '../web/local-index-codec.mjs';
import {createBackup,readBackup} from '../web/backup.mjs';
import {RecognitionHistory,recognitionSong} from '../web/recognition-data.mjs';
import {mediaRevisionKey} from '../web/media-identity.mjs';
const song=(id='local-one')=>({id,source:'local',title:'山海',artist:'听岚',album:'本地',size:4,type:'audio/wav',addedAt:1,durationMs:120000,cached:true});
const marks=(pairs=[[123,1],[456,2]])=>{const b=new ArrayBuffer(pairs.length*8),v=new DataView(b);pairs.forEach(([h,t],i)=>{v.setInt32(i*8,h,true);v.setInt32(i*8+4,t,true);});return b;};
async function fixture(){globalThis.indexedDB=new IDBFactory();const library=new LibraryStore();await library.open();const index=new LocalIndexStore(library);await library.putTrack(song(),new Blob(['WAVE']));return {library,index};}
async function save(index,id='local-one'){const s=await index.source(id);assert(s);assert.equal(await index.save(id,s.revision,marks(),{epoch:s.epoch}),true);return s;}

test('head, middle and tail use distinct bounded 40-second windows with absolute frame offsets',()=>{
  assert.deepEqual(indexWindows(120).map(w=>[w.startMs,w.seconds,w.frameOffset]),[[0,40,0],[40000,40,1250],[80000,40,2500]]);
  assert.equal(indexWindows(12).length,1);assert.equal(indexWindows(60).length,3);assert.throws(()=>indexWindows(Infinity));assert.throws(()=>indexWindows(1));
});
test('binary landmarks reject malformed, oversized and invalid hash/time fields',()=>{
  for(const b of [new ArrayBuffer(0),new ArrayBuffer(9),new ArrayBuffer(LOCAL_INDEX.marks*8+8),marks([[-1,0]]),marks([[2**25,0]]),marks([[1,-1]]),marks([[1,10000001]])])assert.throws(()=>validateMarks(b));
  assert.equal(validateMarks(marks()).byteLength,16);assert.throws(()=>combineMarks([]));assert.equal(combineMarks([marks(),marks()]).byteLength,32);
});
test('PCM mixing and resampling preserve passband, reject invalid channels and keep worker input bounded',()=>{
  const tone=(hz,rate=48000)=>Float32Array.from({length:rate},(_,i)=>.2*Math.sin(i*2*Math.PI*hz/rate));
  const rms=bytes=>{const s=new Int16Array(bytes.buffer);return Math.sqrt(s.reduce((sum,n)=>sum+n*n,0)/s.length)/32768;};
  assert(rms(localPcm([tone(440)],48000))>.13);assert(rms(localPcm([tone(12000)],48000))<.005);
  const positive=new Float32Array(4096).fill(.25),negative=new Float32Array(4096).fill(-.25);assert.equal(rms(localPcm([positive,negative],16000)),0);
  assert.throws(()=>localPcm(Array(9).fill(positive),16000));const bad=positive.slice();bad[200]=NaN;assert.throws(()=>localPcm([bad],16000));assert.throws(()=>localPcm([new Float32Array(640001)],16000));
});
test('candidate upper bounds preserve a low-diversity runner which can invalidate an otherwise accepted match',()=>{
  const query=marks([...Array.from({length:40},(_,i)=>[1,i]),...Array.from({length:20},(_,i)=>[2+i%11,i])]);
  const terms=fingerprintTerms(query),bound=voteBound(terms,new Uint32Array([1]));assert.equal(bound.votes,40);assert.equal(bound.shared,1);
  assert.equal(canChangeDecision(bound,{votes:60,frames:40,hashes:12}),true);assert.equal(canChangeDecision({votes:0},{votes:0}),false);assert.equal(canChangeDecision({votes:10},{votes:200,frames:40,hashes:12}),false);
});
test('same-ID audio replacement invalidates old landmarks atomically, while title and artwork edits preserve them',async()=>{
  const {library,index}=await fixture();try{const old=await save(index);await library.patchTrack('local-one',{title:'新歌名'});await library.setArtwork('local-one',new Blob(['art']),new Blob(['thumb']));assert.equal((await index.info()).count,1);
    await library.putTrack({...song(),title:'替换音频'},new Blob(['NEW!']));assert.equal((await index.info()).count,0);assert.equal(await index.save('local-one',old.revision,marks(),{epoch:old.epoch}),false);assert.equal(await index.resolve('local-one',old.revision,{epoch:old.epoch}),null);
  }finally{library.db.close();}
});
test('clear epoch rejects an in-flight old build and old matches even when media is unchanged',async()=>{
  const {library,index}=await fixture();try{const old=await save(index);await index.clear();assert.equal((await index.info()).count,0);assert.equal(await index.save('local-one',old.revision,marks(),{epoch:old.epoch}),false);assert.equal(await index.resolve('local-one',old.revision,{epoch:old.epoch}),null);assert.notEqual((await index.source('local-one')).epoch,old.epoch);assert.equal((await library.read('media','local-one')).size,4);}finally{library.db.close();}
});
test('removal, cache cleaning and missing cache bytes invalidate corresponding derived records',async()=>{
  const {library,index}=await fixture();try{await save(index);await library.remove('local-one');assert.equal((await index.info()).count,0);assert.equal(await library.read('settings',mediaRevisionKey('local-one')),undefined);
    const remote={...song('qq-ABCDE1'),source:'qq',remoteId:'ABCDE1',cacheMode:'automatic',cacheSavedAt:1,cacheTouchedAt:1};await library.putTrack(remote,new Blob(['WAVE']));await save(index,remote.id);await new CacheStore(library).clean({ids:[remote.id]});assert.equal((await index.info()).count,0);assert.equal(await index.source(remote.id),null);
    await new CacheStore(library).save(remote.id,new Blob(['NEXT']),{mode:'download'});await save(index,remote.id);await library.write(['media'],tx=>tx.objectStore('media').delete(remote.id));await new CacheStore(library).missing(remote.id);assert.equal((await index.info()).count,0);
  }finally{library.db.close();}
});
test('backup restores recognition mode and local history but excludes rebuildable marks and source revisions',async()=>{
  const {library,index}=await fixture();try{const original=await save(index);await library.saveSettings({recognitionMode:'offline'});await new RecognitionHistory(library).save({...song(),recognizedVia:'local'},{now:1000});
    const snapshot=await library.snapshot();assert.equal('fingerprints' in snapshot,false);assert.equal(Object.keys(snapshot.preferences).some(k=>k.startsWith('media-revision:')),false);
    const backup=await createBackup(snapshot),restored=await readBackup(backup.blob);assert.equal(restored.preferences.recognitionMode,'offline');assert.equal(restored.recognitionHistory[0].recognizedVia,'local');assert.equal(restored.recognitionHistory[0].size,0);
    await library.mergeBackup(restored,restored.preferences);assert.equal((await index.info()).count,0);assert.equal(await index.save('local-one',original.revision,marks(),{epoch:original.epoch}),false);assert.equal(await (await library.read('media','local-one')).text(),'WAVE');
  }finally{library.db.close();}
});
test('aborted index transactions preserve previously committed data and never publish partial results',async()=>{
  const {library,index}=await fixture();try{await save(index);const c=new AbortController();c.abort();await assert.rejects(index.clear({signal:c.signal}),{name:'AbortError'});assert.equal((await index.info()).count,1);await assert.rejects(index.source('local-one',{signal:c.signal}),{name:'AbortError'});}finally{library.db.close();}
});
test('300-track bound is enforced transactionally and only actual local or downloaded bytes are eligible',async()=>{
  const {library,index}=await fixture();try{await library.write(['tracks','media'],tx=>{for(let n=1;n<=301;n++){const id='local-'+n;tx.objectStore('tracks').put({...song(id),addedAt:n},id);tx.objectStore('media').put(new Blob(['WAVE']),id);}tx.objectStore('tracks').put({...song('qq-REMOTE'),source:'qq',remoteId:'REMOTE',cached:false},'qq-REMOTE');});
    const eligible=await index.eligible();assert.equal(eligible.length,300);assert.equal(eligible[0].id,'local-301');assert(!eligible.some(t=>t.id==='qq-REMOTE'));assert.equal(await index.source('qq-REMOTE'),null);
    const s=await index.source('local-301');await library.write(['fingerprints'],tx=>{for(let n=1;n<=300;n++)tx.objectStore('fingerprints').put({version:1,bytes:8},'entry-'+n);});await assert.rejects(index.save('local-301',s.revision,marks(),{epoch:s.epoch}),/300/);assert.equal((await index.info()).count,300);
    await index.prune([]);assert.equal((await index.info()).count,0);
  }finally{library.db.close();}
});
test('all platform history identities and artwork hosts are curated without media or PCM fields',()=>{
  for(const [source,id,remoteId,url] of [['local','local-one','','https://other.test/a'],['qq','qq-ABCDE1','ABCDE1','https://y.gtimg.cn/a'],['bili','bili-BV1xx411c7mD','BV1xx411c7mD','https://i0.hdslb.com/a'],['netease','netease-1','1','https://p1.music.126.net/a']]){
    const result=recognitionSong({...song(id),source,remoteId,artworkUrl:url,pcm:[1],fingerprint:'private'});assert.equal(result.source,source);assert.equal(result.size,0);assert.equal(result.cached,false);assert.equal('pcm' in result,false);assert.equal('fingerprint' in result,false);assert.equal(!!result.artworkUrl,source!=='local');
    assert.equal(recognitionSong({...result,artworkUrl:'https://y.gtimg.cn.evil.test/a'}).artworkUrl,'');
  }
  assert.throws(()=>recognitionSong({...song('qq-ABCDE1'),source:'local'}));
});

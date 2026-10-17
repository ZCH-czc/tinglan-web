import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { LibraryStore } from '../web/storage.mjs';
import { createBackup,readBackup } from '../web/backup.mjs';

const track=(id='local-one')=>({id,title:'海风',artist:'听岚',filename:'original.wav',size:4,type:'audio/wav',durationMs:12000,favorite:false,lyrics:'[00:03]你好',addedAt:1,hasArtwork:false});
async function createStore(){globalThis.indexedDB=new IDBFactory();const store=new LibraryStore();await store.open();return store;}
test('handoff metadata import is atomic and preserves existing cache, lyrics and favorites without creating a playlist',async()=>{
  const store=await createStore(),old={...track('qq-001Existing'),favorite:true,lyricsEdited:true};await store.putTrack(old,new Blob(['AUDIO']));const accepted=await store.importHandoff([{...old,favorite:false,lyrics:'remote'},track('qq-001New')]);assert.equal(accepted[0].favorite,true);assert.equal(accepted[0].lyrics,old.lyrics);assert.equal((await store.tracks()).length,2);assert.equal(await (await store.read('media',old.id)).text(),'AUDIO');assert.deepEqual(await store.playlists(),[]);store.db.close();
});
test('malformed handoff data and a transaction cloning failure leave the entire local import unchanged',async()=>{
  const store=await createStore();await store.putTrack(track());await assert.rejects(store.importHandoff([track('qq-new'),{...track('qq-bad'),uncloneable:()=>{}}]));await assert.rejects(store.importHandoff([track('qq-new'),track('qq-new')]));assert.equal((await store.tracks()).length,1);store.db.close();
});
test('handoff imports cannot exceed library capacity and device identity is absent from portable backups',async()=>{
  const store=await createStore();await store.write(['tracks','settings'],tx=>{for(let i=0;i<10000;i++)tx.objectStore('tracks').put(track('saved-'+i),'saved-'+i);tx.objectStore('settings').put('private-device-id','handoff-device-id');});
  await assert.rejects(store.importHandoff([track('qq-new')]));assert.equal((await store.tracks()).length,10000);const snapshot=await store.snapshot();assert.doesNotMatch(JSON.stringify(snapshot.preferences),/private-device-id|handoff-device/);store.db.close();
});
test('platform playlist imports commit all metadata together while preserving local audio, lyrics, artwork and favourites',async()=>{
  const store=await createStore();const existing={...track('qq-001Existing'),favorite:true,lyricsEdited:true,lyrics:'[00:01]我的歌词'};
  await store.putTrack(existing,new Blob(['AUDIO']),[new Blob(['COVER']),new Blob(['THUMB'])]);
  const rows=[{...track('qq-001Existing'),lyrics:'remote',favorite:false},track('qq-001New')],playlist={id:'collection-qq-123',name:'收藏歌单',trackIds:rows.map(row=>row.id)};
  const accepted=await store.importPlaylist(rows,playlist);assert.equal(accepted[0].favorite,true);assert.equal(accepted[0].lyrics,'[00:01]我的歌词');assert.equal(accepted[0].lyricsEdited,true);
  assert.equal((await store.tracks()).length,2);assert.equal(await (await store.read('media','qq-001Existing')).text(),'AUDIO');assert.equal(await (await store.read('artwork','qq-001Existing')).text(),'COVER');assert.deepEqual((await store.playlists())[0].trackIds,playlist.trackIds);store.db.close();
});
test('cancelled or invalid platform imports leave both the song list and playlist untouched',async()=>{
  const store=await createStore();await store.putTrack(track());const controller=new AbortController();controller.abort();
  await assert.rejects(store.importPlaylist([track('qq-new')],{id:'p',name:'歌单',trackIds:['qq-new']},{signal:controller.signal}),error=>error.name==='AbortError');
  const running=new AbortController(),pending=store.importPlaylist([track('qq-live')],{id:'live',name:'歌单',trackIds:['qq-live']},{signal:running.signal});running.abort();await assert.rejects(pending,error=>error.name==='AbortError');
  await assert.rejects(store.importPlaylist([track('qq-new'),{...track('qq-bad'),invalid:()=>{}}],{id:'p',name:'歌单',trackIds:['qq-new','qq-bad']}));
  assert.equal((await store.tracks()).length,1);assert.deepEqual(await store.playlists(),[]);
  await assert.rejects(store.importPlaylist([track('qq-new')],{id:'p',name:'歌单',trackIds:['missing']}),/identifier/i);assert.equal((await store.tracks()).length,1);store.db.close();
});
test('playlist capacity is enforced inside its transaction and duplicate input records cannot inflate it',async()=>{
  const store=await createStore();await store.write(['playlists'],tx=>{for(let i=0;i<200;i++)tx.objectStore('playlists').put({id:'p-'+i,name:'歌单',trackIds:[]},'p-'+i);});
  await assert.rejects(store.importPlaylist([track('qq-new')],{id:'new-p',name:'歌单',trackIds:['qq-new']}));assert.equal((await store.tracks()).length,0);assert.equal((await store.playlists()).length,200);
  const accepted=await store.importPlaylist([track('qq-new'),track('qq-new')],{id:'p-0',name:'更新歌单',trackIds:['qq-new']});assert.equal(accepted.length,1);assert.equal((await store.tracks()).length,1);assert.equal((await store.playlists()).length,200);store.db.close();
});
test('version 1 audio and preferences survive upgrade to version 6 including derived fingerprints',async()=>{
  globalThis.indexedDB=new IDBFactory();
  await new Promise((resolve,reject)=>{const r=indexedDB.open('tinglan-web-library',1);r.onupgradeneeded=()=>{for(const name of ['tracks','media','artwork','settings'])r.result.createObjectStore(name)};r.onsuccess=()=>{const db=r.result;const tx=db.transaction(['tracks','media','settings'],'readwrite');tx.objectStore('tracks').put(track(),'local-one');tx.objectStore('media').put(new Blob(['WAVE']),'local-one');tx.objectStore('settings').put({volume:42},'preferences');tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)};r.onerror=()=>reject(r.error)});
  const store=new LibraryStore();await store.open();assert.equal((await store.tracks())[0].title,'海风');assert.equal(await (await store.read('media','local-one')).text(),'WAVE');assert.equal((await store.settings()).volume,42);assert.deepEqual(await store.playlists(),[]);assert.equal(store.db.version,6);assert.ok(store.db.objectStoreNames.contains('listening'));assert.ok(store.db.objectStoreNames.contains('fingerprints'));store.db.close();
});
test('a failed audio insertion rolls back metadata and artwork in the same transaction',async()=>{
  const store=await createStore();await store.putTrack(track(),new Blob(['WAVE']));
  await assert.rejects(store.write(['tracks','media','artwork'],tx=>{tx.objectStore('tracks').put(track('local-bad'),'local-bad');tx.objectStore('artwork').put(new Blob(['art']),'local-bad');tx.objectStore('media').put(()=>{},'local-bad')}));
  assert.equal((await store.tracks()).length,1);assert.equal(await store.read('artwork','local-bad'),undefined);store.db.close();
});
test('independent metadata patches preserve simultaneous lyrics and favourite updates',async()=>{
  const store=await createStore();await store.putTrack(track(),new Blob(['WAVE']));await Promise.all([store.patchTrack('local-one',{favorite:true}),store.patchTrack('local-one',{lyrics:'[00:04]新歌词'}),store.patchTrack('local-one',{album:'航线'})]);const saved=(await store.tracks())[0];assert.equal(saved.favorite,true);assert.equal(saved.lyrics,'[00:04]新歌词');assert.equal(saved.album,'航线');store.db.close();
});
test('deleting a song atomically removes audio, artwork and every playlist membership',async()=>{
  const store=await createStore();await store.putTrack(track(),new Blob(['WAVE']),[new Blob(['art']),new Blob(['thumb'])]);await store.putPlaylist({id:'p',name:'歌单',trackIds:['local-one'],createdAt:1});await store.remove('local-one');assert.equal((await store.tracks()).length,0);assert.equal(await store.read('media','local-one'),undefined);assert.equal(await store.read('artwork','local-one:thumb'),undefined);assert.deepEqual((await store.playlists())[0].trackIds,[]);store.db.close();
});
test('complete backup merges actual bytes and preserves other songs, restoring uncached references without stale audio',async()=>{
  const store=await createStore();await store.putTrack(track(),new Blob(['WAVE']));await store.putTrack(track('local-other'),new Blob(['KEEP']));
  const online={...track('netease-123'),source:'netease',remoteId:'123',size:0,cached:false,lyricsEdited:true,originalLyrics:'[00:03]原文'};
  const snapshot={tracks:[online],media:[],artwork:[],playlists:[{id:'night',name:'夜间',trackIds:['netease-123'],createdAt:1}],preferences:{currentId:'netease-123',position:3000,queue:['netease-123'],cookie:'not in backups'}};
  const portable=await createBackup(snapshot);const restored=await readBackup(portable.blob);assert.equal(restored.media.length,0);assert.equal(restored.tracks[0].lyricsEdited,true);assert.equal('cookie' in restored.preferences,false);
  await store.write(['media'],tx=>tx.objectStore('media').put(new Blob(['stale']),'netease-123'));await store.mergeBackup(restored,restored.preferences);
  assert.equal((await store.tracks()).length,3);assert.equal(await (await store.read('media','local-other')).text(),'KEEP');assert.equal(await store.read('media','netease-123'),undefined);assert.deepEqual((await store.playlists())[0].trackIds,['netease-123']);store.db.close();
});

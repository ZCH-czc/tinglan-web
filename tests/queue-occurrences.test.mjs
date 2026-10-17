import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { LibraryStore } from '../web/storage.mjs';
import { normalizePreferences } from '../web/library-data.mjs';
import { createBackup, readBackup } from '../web/backup.mjs';
import { handoffPlan, buildHandoff } from '../web/playback-handoff.mjs';
import { BrowserPlayback } from '../web/playback.mjs';
import { editQueueEntry } from '../web/queue-entry-actions.mjs';

const module = await import('../build/dist/engine/tinglan-web-core.mjs');
const engine = module.engineVersion ? module : module.default;
const rows = () => JSON.parse(engine.queueItemsJson(0,500));
const ids = () => JSON.parse(engine.queueIdsJson());
const populate = (queue=['a','b','a'],index=2) => {
  engine.resetEngine();
  for(const id of new Set(queue))assert.equal(engine.upsertMetadata(id,id,'听岚',100000,false),true);
  assert.equal(engine.setQueueIdsAt(queue.join('\n'),index),true);
  return rows();
};

test('actual Wasm keeps distinct duplicate keys when the audio host reselects an asset',()=>{
  const queue=populate(['a','a','b'],0);assert.equal(new Set(queue.map(row=>row.queueKey)).size,3);assert.deepEqual(queue.map(row=>row.queueIndex),[0,1,2]);
  engine.setPosition(12345);assert.equal(engine.nextTrack(false),'a');assert.equal(engine.currentQueueIndex(),1);assert.equal(engine.positionMs(),0);
  assert.equal(engine.selectTrack('a'),true);assert.equal(engine.currentQueueKey(),queue[1].queueKey);
  assert.equal(engine.previousTrack(),'a');assert.equal(engine.currentQueueKey(),queue[0].queueKey);
  assert.equal(engine.selectQueueEntry(queue[1].queueKey),true);engine.setRepeatMode('ONE');assert.equal(engine.nextTrack(true),'a');assert.equal(engine.currentQueueKey(),queue[1].queueKey);
  assert.equal(engine.nextTrack(false),'b');assert.equal(engine.currentQueueIndex(),2);
});

test('a delayed menu cannot move or remove another occurrence with the same song ID',()=>{
  const queue=populate(['a','a','b'],1),old={id:'a',key:queue[0].queueKey,action:'remove'},menu={active:true,id:'a',key:queue[1].queueKey};
  engine.setPosition(17000);assert.throws(()=>editQueueEntry(engine,old,menu),/expired/i);assert.equal(engine.queueSize(),3);assert.equal(engine.positionMs(),17000);
  const moved=editQueueEntry(engine,{id:'a',key:menu.key,action:'move',delta:1},menu);assert.deepEqual(moved,{changed:true,removedCurrent:false});assert.equal(engine.currentQueueIndex(),2);assert.equal(engine.currentQueueKey(),menu.key);assert.equal(engine.positionMs(),17000);
  assert.throws(()=>editQueueEntry(engine,{id:'a',key:menu.key,action:'move',delta:500},menu),/direction/i);
  const removed=editQueueEntry(engine,old,{active:true,id:'a',key:old.key});assert.deepEqual(removed,{changed:true,removedCurrent:false});assert.equal(engine.currentQueueKey(),menu.key);assert.equal(engine.positionMs(),17000);
  assert.throws(()=>editQueueEntry(engine,old,{active:true,id:'a',key:old.key}),/expired/i);assert.throws(()=>editQueueEntry(engine,{...old,key:menu.key}, {...menu,active:false}),/expired/i);
});

test('removing the current duplicate advances to the adjacent occurrence and preserves library data',()=>{
  const queue=populate(['a','a','b'],0);engine.setLyrics('a','[00:01]歌词');engine.toggleFavorite('a');engine.upsertPlaylist('p','歌单','a\nb',1);engine.setPosition(17000);
  const result=editQueueEntry(engine,{id:'a',key:queue[0].queueKey,action:'remove'},{active:true,id:'a',key:queue[0].queueKey});
  assert.equal(result.removedCurrent,true);assert.equal(engine.currentId(),'a');assert.equal(engine.currentQueueKey(),queue[1].queueKey);assert.equal(engine.positionMs(),0);
  assert.equal(JSON.parse(engine.currentTrackJson()).favorite,true);assert.equal(JSON.parse(engine.lyricsJson('a')).lines[0].text,'歌词');assert.deepEqual(JSON.parse(engine.playlistJson('p')).trackIds,['a','b']);
});

test('deleting a library asset removes every queue occurrence without disturbing another active song',()=>{
  const queue=populate(['a','b','a','c','a'],1);engine.setPosition(19000);assert.equal(engine.removeTrack('a'),true);
  assert.deepEqual(ids(),['b','c']);assert.equal(engine.currentQueueKey(),queue[1].queueKey);assert.equal(engine.positionMs(),19000);assert.equal(engine.queueEntryId(queue[0].queueKey),'');
  assert.equal(engine.removeTrack('b'),true);assert.equal(engine.currentId(),'c');assert.equal(engine.currentQueueKey(),queue[3].queueKey);assert.equal(engine.positionMs(),0);
});

test('play next and append create new keys without implicitly queuing saved metadata',()=>{
  const queue=populate(['a','b'],0);engine.setPosition(9000);assert.equal(engine.upsertMetadata('c','新歌曲','歌手',100000,false),true);assert.deepEqual(ids(),['a','b']);
  const next=engine.insertQueueTrack('a',true),last=engine.insertQueueTrack('c',false);assert.ok(next);assert.ok(last);assert.notEqual(next,queue[0].queueKey);assert.deepEqual(ids(),['a','a','b','c']);assert.equal(engine.currentQueueKey(),queue[0].queueKey);assert.equal(engine.positionMs(),9000);
  engine.clearQueue();assert.equal(engine.selectQueueEntry(next),false);const fresh=engine.insertQueueTrack('a',false);assert.notEqual(fresh,next);assert.equal(engine.currentQueueKey(),fresh);
  engine.resetEngine();engine.upsertMetadata('a','a','听岚',100000,false);assert.notEqual(engine.insertQueueTrack('a',false),fresh);assert.equal(engine.selectQueueEntry(fresh),false);
});

test('invalid queue replacements are atomic and bounded windows expose the exact repeated occurrence',()=>{
  const queue=populate(['a','b','a'],2);engine.setPosition(12345);
  for(const [input,index] of [['a\nmissing',0],['a\na',2],['a\na',-1],['',0]])assert.equal(engine.setQueueIdsAt(input,index),false);
  assert.deepEqual(rows(),queue);assert.equal(engine.positionMs(),12345);
  engine.setQueueIdsAt(Array(10000).fill('a').join('\n'),9500);const window=JSON.parse(engine.queueItemsJson(9380,240));assert.equal(window.length,240);assert.equal(window[120].queueKey,engine.currentQueueKey());assert.equal(window[120].queueIndex,9500);
  assert.equal(JSON.parse(engine.queueItemsJson(-1,10000)).length,500);assert.equal(engine.insertQueueTrack('a',true),'');
  for(let i=0;i<10000;i++){engine.nextTrack(false);engine.previousTrack();}assert.equal(engine.currentQueueIndex(),9500);assert.equal(engine.currentQueueKey(),window[120].queueKey);
});

test('portable preferences retain duplicates, remap the cursor after filtering, and migrate legacy queues',()=>{
  const known=new Set(['a','b']);
  const accepted=normalizePreferences({currentId:'a',position:12345,queue:['missing','a','b','a'],queueIndex:3},known);assert.deepEqual(accepted.queue,['a','b','a']);assert.equal(accepted.queueIndex,2);assert.equal(accepted.position,12345);
  for(const queueIndex of [undefined,-1,1,100,NaN])assert.equal(normalizePreferences({currentId:'a',queue:['a','b','a'],queueIndex},known).queueIndex,0);
  assert.equal(normalizePreferences({currentId:'a',queue:['a','b','a'],queueIndex:2},known).queueIndex,2);
  const standalone=normalizePreferences({currentId:'b',queue:['a','a'],queueIndex:1},known);assert.equal(standalone.queueIndex,-1);assert.equal(standalone.currentId,'b');
  const large=normalizePreferences({currentId:'a',queue:Array(10001).fill('a'),queueIndex:9999},known);assert.equal(large.queue.length,10000);assert.equal(large.queueIndex,9999);
});

test('backup, IndexedDB merge and a fresh Wasm engine restore the second occurrence and paused position',async()=>{
  globalThis.indexedDB=new IDBFactory();const store=new LibraryStore();await store.open();
  try {
    const tracks=[{id:'qq-001AbCdefghij',remoteId:'001AbCdefghij',source:'qq',title:'海风',size:0},{id:'netease-123',remoteId:'123',source:'netease',title:'山间',size:0}];
    const queue=[tracks[0].id,tracks[1].id,tracks[0].id],preferences=normalizePreferences({currentId:queue[2],queue,queueIndex:2,position:19000},new Set(queue));
    const exported=await createBackup({tracks,media:[],artwork:[],playlists:[],preferences}),restored=await readBackup(exported.blob);await store.mergeBackup(restored,restored.preferences);
    const saved=await store.settings();assert.deepEqual(saved.queue,queue);assert.equal(saved.queueIndex,2);engine.resetEngine();for(const row of await store.tracks())engine.upsertMetadata(row.id,row.title,row.artist,100000,row.favorite);
    assert.equal(engine.setQueueIdsAt(saved.queue.join('\n'),saved.queueIndex),true);engine.selectTrack(saved.currentId);engine.setPosition(saved.position);assert.equal(engine.currentQueueIndex(),2);assert.equal(engine.positionMs(),19000);assert.equal(new Set(rows().map(row=>row.queueKey)).size,3);
  }finally{store.db.close();}
});

class FakeAudio extends EventTarget {
  constructor(){super();Object.assign(this,{src:'',paused:true,currentTime:0,duration:100,readyState:0,playbackRate:1,volume:.8});}
  setAttribute(){} removeAttribute(){this.src='';} load(){this.currentTime=0;}
  pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}
  async play(){this.paused=false;this.dispatchEvent(new Event('playing'));}
}

test('Android duplicate relay imports one metadata record and the actual playback host resumes the selected repeat',async()=>{
  const now=1700000000000,row={id:'qq:track:001AbCdefghij',title:'海风',artist:'听岚',duration:100},snapshot={sessionId:'android-session',deviceId:'android',deviceName:'车机',updatedAt:now,tracks:[row,row],index:1,positionMs:12345},plan=handoffPlan(snapshot,{now});
  globalThis.indexedDB=new IDBFactory();const store=new LibraryStore();await store.open();let host;
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'document'),audio=new FakeAudio();Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>audio,body:{append(){}}}});
  try {
    const imported=await store.importHandoff(plan.metadata);assert.equal(imported.length,1);assert.equal((await store.tracks()).length,1);assert.equal(plan.ids.length,2);
    engine.resetEngine();for(const row of imported)engine.upsertMetadata(row.id,row.title,row.artist,row.durationMs,row.favorite);engine.setQueueIdsAt(plan.ids.join('\n'),plan.index);const key=engine.currentQueueKey(),errors=[];
    host=new BrowserPlayback(engine,{sourceFor:async()=>new Blob(['fixture audio'])},{error:error=>errors.push(error),state(){},track(){},time(){},duration(){}});
    assert.equal(await host.switchTo(plan.currentId,{play:false,position:plan.position}),true);audio.readyState=1;audio.dispatchEvent(new Event('loadedmetadata'));assert.equal(audio.currentTime,12.345);assert.equal(audio.paused,true);assert.equal(engine.currentQueueKey(),key);assert.equal(engine.currentQueueIndex(),1);assert.deepEqual(errors,[]);
    const outgoing=buildHandoff(ids().map(id=>imported.find(row=>row.id===id)),engine.currentId(),engine.positionMs(),{deviceId:'web',deviceName:'浏览器',sessionId:'web-session',currentIndex:engine.currentQueueIndex(),now});assert.equal(outgoing.index,1);assert.equal(outgoing.tracks.length,2);assert.equal(outgoing.positionMs,12345);
    host.next();await new Promise(resolve=>setImmediate(resolve));assert.equal(engine.currentQueueIndex(),0);assert.notEqual(engine.currentQueueKey(),key);assert.equal(engine.positionMs(),0);assert.equal(audio.paused,false);assert.deepEqual(errors,[]);
  }finally{host?.stop();store.db.close();if(descriptor)Object.defineProperty(globalThis,'document',descriptor);else delete globalThis.document;}
});

test('outgoing relay windows use the exact selected duplicate index and reject a mismatched cursor',()=>{
  const now=1700000000000,row={id:'qq-001AbCdefghij',remoteId:'001AbCdefghij',source:'qq',title:'海风',artist:'听岚',durationMs:100000},queue=Array(70).fill(row),options={deviceId:'web',deviceName:'浏览器',sessionId:'s',now};
  const snapshot=buildHandoff(queue,row.id,17000,{...options,currentIndex:55});assert.equal(snapshot.tracks.length,25);assert.equal(snapshot.index,10);assert.equal(snapshot.positionMs,17000);
  for(const currentIndex of [-1,70,.5])assert.throws(()=>buildHandoff(queue,row.id,0,{...options,currentIndex}),/position/i);
  assert.throws(()=>buildHandoff(queue,'qq-001Wrong',0,{...options,currentIndex:1}),/position/i);
});

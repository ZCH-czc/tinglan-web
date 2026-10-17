import test from 'node:test';
import assert from 'node:assert/strict';
import {editQueueEntry,editVisibleQueueEntry,seekCurrentTrack} from '../web/queue-entry-actions.mjs';
import {normalizePreferences} from '../web/library-data.mjs';
import {createBackup,readBackup} from '../web/backup.mjs';

const wasm=await import('../build/dist/engine/tinglan-web-core.mjs');
const engine=wasm.engineVersion?wasm:wasm.default;
function populate(){engine.resetEngine();for(const id of ['a','b','c'])engine.upsertMetadata(id,id,'听岚',60000,false);engine.setQueueIdsAt('a\nb\na\nc',2);engine.setPosition(17000);return JSON.parse(engine.queueItemsJson(0,240));}
const view=rows=>({open:true,locked:false,keys:rows.map(row=>row.queueKey)});

test('Wasm clear remaining and undo keep the exact playing duplicate and time',()=>{
  const rows=populate(),key=engine.currentQueueKey();assert.equal(engine.queueDurationMs(),240000);
  assert.equal(engine.clearOtherQueueEntries(),3);assert.equal(engine.currentQueueKey(),key);assert.equal(engine.positionMs(),17000);assert.equal(engine.queueSize(),1);
  assert.equal(engine.undoQueueEdit(),true);assert.deepEqual(JSON.parse(engine.queueItemsJson(0,240)),rows);assert.equal(engine.positionMs(),17000);assert.equal(engine.currentQueueIndex(),2);
});
test('locked or closed queue rejects pointer, keyboard and delayed menu edits',()=>{
  const rows=populate(),row=rows[0],request={id:row.id,key:row.queueKey,action:'remove'},before=engine.queueIdsJson();
  assert.throws(()=>editVisibleQueueEntry(engine,request,{...view(rows),locked:true}),/locked/i);
  assert.throws(()=>editVisibleQueueEntry(engine,request,{...view(rows),open:false}),/changed/i);
  assert.throws(()=>editQueueEntry(engine,request,{active:true,id:row.id,key:row.queueKey,locked:true}),/locked/i);
  assert.equal(engine.queueIdsJson(),before);assert.equal(engine.positionMs(),17000);
});
test('dragging targets exact visible occurrence keys and rejects an old target',()=>{
  const rows=populate(),key=engine.currentQueueKey();
  assert.equal(editVisibleQueueEntry(engine,{id:'a',key:rows[0].queueKey,destinationKey:rows[3].queueKey,action:'move-to'},view(rows)).changed,true);
  assert.deepEqual(JSON.parse(engine.queueIdsJson()),['b','a','c','a']);assert.equal(engine.currentQueueKey(),key);assert.equal(engine.positionMs(),17000);
  engine.removeQueueEntry(rows[3].queueKey);
  assert.throws(()=>editVisibleQueueEntry(engine,{id:'a',key:rows[0].queueKey,destinationKey:rows[3].queueKey,action:'move-to'},view(rows)),/target/i);
  assert.throws(()=>editVisibleQueueEntry(engine,{id:'a',key:rows[0].queueKey,destinationKey:key,action:'move-to'},view(rows.slice(1,3))),/changed/i);
});
test('play next moves the existing occurrence without duplicating or restarting current audio',()=>{
  const rows=populate(),key=engine.currentQueueKey();
  const request={id:'a',key:rows[0].queueKey,action:'next'};
  assert.equal(editQueueEntry(engine,request,{active:true,...request}).changed,true);
  assert.equal(engine.queueSize(),4);assert.equal(engine.currentQueueKey(),key);assert.equal(engine.positionMs(),17000);
  engine.nextTrack(false);assert.equal(engine.currentQueueKey(),rows[0].queueKey);
});
test('swipe current removal and undo preserve the replacement song clock',()=>{
  const rows=populate(),row=rows[2];const result=editVisibleQueueEntry(engine,{id:row.id,key:row.queueKey,action:'remove'},view(rows));
  assert.equal(result.removedCurrent,true);assert.equal(engine.currentId(),'c');const key=engine.currentQueueKey();engine.setPosition(9000);
  assert.equal(engine.undoQueueEdit(),true);assert.equal(engine.currentQueueKey(),key);assert.equal(engine.positionMs(),9000);
});
test('outgoing scrub cannot seek a new song or another duplicate occurrence',()=>{
  const rows=populate(),calls=[],host={seek:value=>calls.push(value)},request={id:'a',key:rows[2].queueKey,position:'28000'};
  assert.equal(seekCurrentTrack(engine,host,request),true);assert.deepEqual(calls,[28000]);
  engine.selectQueueEntry(rows[0].queueKey);assert.equal(seekCurrentTrack(engine,host,request),false);
  for(const position of ['NaN','Infinity',-1])assert.equal(seekCurrentTrack(engine,host,{...request,key:rows[0].queueKey,position}),false);
  engine.selectQueueEntry(rows[1].queueKey);assert.equal(seekCurrentTrack(engine,host,request),false);assert.deepEqual(calls,[28000]);
});
test('random order visits every Wasm occurrence without changing list display order',()=>{
  populate();const before=engine.queueIdsJson();engine.setShuffleEnabled(true);const keys=new Set([engine.currentQueueKey()]);
  for(let i=0;i<3;i++){engine.nextTrack(true);keys.add(engine.currentQueueKey())}assert.equal(keys.size,4);assert.equal(engine.nextTrack(true),'');assert.equal(engine.queueIdsJson(),before);
  engine.setShuffleEnabled(false);assert.equal(engine.shuffleEnabled(),false);
});
test('queue edit lock and random order survive backup while non-booleans are rejected',async()=>{
  const preferences=normalizePreferences({queueLocked:true,shuffle:true});assert.equal(preferences.queueLocked,true);assert.equal(preferences.shuffle,true);
  assert.equal(normalizePreferences({queueLocked:'true',shuffle:1}).shuffle,false);assert.equal(normalizePreferences({}).queueLocked,false);
  const result=await createBackup({tracks:[],media:[],artwork:[],playlists:[],preferences});
  const restored=await readBackup(result.blob);assert.equal(restored.preferences.queueLocked,true);assert.equal(restored.preferences.shuffle,true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotBridge } from '../web/snapshot-bridge.mjs';

test('transfer symbols and private receipt filenames are global deltas and never retained in page snapshots',()=>{
  const messages=[],bridge=new SnapshotBridge(raw=>messages.push(JSON.parse(raw))),transferQrRows=['101','010'],transferReceipts=[{id:'private-row',name:'private-file.wav'}],empty=[];
  for(let i=0;i<1000;i++)bridge.publish({page:i%2?'settings':'transfer',transferQrRows,transferReceipts,progress:i/1000});
  assert.deepEqual(messages[0].transferQrRows,transferQrRows);assert.ok(messages.slice(1).every(row=>!('transferQrRows' in row) && !('transferReceipts' in row)));assert.ok([...bridge.pages.values()].every(page=>!page.has('transferQrRows') && !page.has('transferReceipts')));
  bridge.publish({page:'home',transferQrRows:empty,transferReceipts:empty});assert.deepEqual(messages.at(-1).transferQrRows,[]);assert.deepEqual(messages.at(-1).transferReceipts,[]);
});

test('switching repeated queue occurrences sends a scalar key without retransferring the retained window',()=>{
  const messages=[],bridge=new SnapshotBridge(raw=>messages.push(JSON.parse(raw))),queue=Array.from({length:240},(_,index)=>({id:'same-asset',queueKey:'entry-'+index,queueIndex:9380+index,title:'同一首音乐'}));
  for(let i=0;i<1000;i++)bridge.publish({page:'library',queue,queueTotal:10000,queueOffset:9380,queueCurrentKey:queue[120+i%2].queueKey});
  assert.equal(messages[0].queue.length,240);assert.equal(messages[1].queueCurrentKey,'entry-121');assert.ok(messages.slice(1).every(row=>!('queue' in row) && JSON.stringify(row).length<150));
  bridge.publish({page:'search',queue});bridge.publish({page:'library',queue,queueCurrentKey:'entry-120'});assert.equal('queue' in messages.at(-1),false);
});
test('account-owned folder selections are global deltas and never survive in page snapshots',()=>{
  const messages=[],bridge=new SnapshotBridge(raw=>messages.push(JSON.parse(raw))),folders=Array.from({length:500},(_,i)=>({id:String(i),title:'账号收藏夹',checked:false})),empty=[];
  for(let i=0;i<100;i++)bridge.publish({page:i%2?'search':'home',biliActionFolders:folders});assert.equal(messages[0].biliActionFolders.length,500);assert.ok(messages.slice(1).every(value=>!('biliActionFolders' in value)));
  bridge.publish({page:'settings',biliActionFolders:empty});bridge.publish({page:'home',biliActionFolders:empty});assert.deepEqual(messages.at(-2).biliActionFolders,[]);assert.equal('biliActionFolders' in messages.at(-1),false);assert.ok([...bridge.pages.values()].every(page=>!page.has('biliActionFolders')));
});
test('closing login clears its global QR data across navigation without retaining symbols in page snapshots',()=>{
  const messages=[],bridge=new SnapshotBridge(raw=>messages.push(JSON.parse(raw))),rows=['101','010','101'],empty=[],accounts=[{source:'bili',connected:false}];
  bridge.publish({page:'home',qrRows:rows,accounts});bridge.publish({page:'settings',qrRows:empty,accounts});bridge.publish({page:'home',qrRows:empty,accounts});
  assert.deepEqual(messages[1].qrRows,[]);assert.equal('qrRows' in messages[2],false);assert.equal('accounts' in messages[1],false);
  assert.ok([...bridge.pages.values()].every(page=>!page.has('qrRows') && !page.has('accounts')));assert.equal(bridge.global.get('qrRows'),empty);
  bridge.reset();bridge.publish({page:'home',qrRows:empty,accounts});assert.deepEqual(messages.at(-1).qrRows,[]);assert.deepEqual(messages.at(-1).accounts,accounts);
});
test('different reply and playlist pages retain their own collections while snapshot memory stays bounded',()=>{
  const messages=[],bridge=new SnapshotBridge(raw=>messages.push(JSON.parse(raw))),first=[{id:'first'}],second=[{id:'second'}];
  bridge.publish({page:'comments',viewKey:'comments|song|root-a',comments:first});bridge.publish({page:'comments',viewKey:'comments|song|root-b',comments:second});bridge.publish({page:'comments',viewKey:'comments|song|root-a',comments:first});assert.equal('comments' in messages.at(-1),false);
  for(let i=0;i<40;i++)bridge.publish({page:'collection',viewKey:'collection|'+i,collectionSongs:[{id:String(i)}]});assert.equal(bridge.pages.size,24);
});
test('playback updates retain a large library without repeatedly serializing it across Wasm',()=>{
  const messages=[];const bridge=new SnapshotBridge(raw=>messages.push(raw));
  const songs=Array.from({length:10000},(_,id)=>({id:`song-${id}`,title:'听岚测试歌曲',artist:'听岚'}));
  for(let i=0;i<1000;i++)bridge.publish({songs,status:i%2?'playing':'paused',page:'library'});
  assert.equal(JSON.parse(messages[0]).songs.length,10000);
  assert.ok(Buffer.byteLength(messages[0])>500000);assert.ok(messages.slice(1).every(raw=>raw.length<100 && !('songs' in JSON.parse(raw))));
  bridge.publish({songs:[...songs,{id:'new'}],status:'paused'});assert.equal(JSON.parse(messages.at(-1)).songs.length,10001);
});
test('an explicitly empty view clears previous rows and a reset republishes all collections',()=>{
  const messages=[];const bridge=new SnapshotBridge(raw=>messages.push(JSON.parse(raw)));
  const songs=[{id:'a'}];bridge.publish({songs});bridge.publish({songs:[]});assert.deepEqual(messages.at(-1).songs,[]);
  bridge.publish({songs});bridge.reset();bridge.publish({songs});assert.deepEqual(messages.at(-1).songs,songs);
});
test('returning to a retained page reuses its collection rather than retransferring it',()=>{
  const messages=[],bridge=new SnapshotBridge(raw=>messages.push(JSON.parse(raw)));const library=[{id:'a'}],results=[{id:'b'}];
  bridge.publish({page:'library',songs:library});bridge.publish({page:'search',songs:results});bridge.publish({page:'library',songs:library});
  assert.equal(messages.at(-1).page,'library');assert.equal('songs' in messages.at(-1),false);
});
test('video status updates do not retransmit a 4000-row danmaku document or retained author page',()=>{
  const messages=[],bridge=new SnapshotBridge(raw=>messages.push(JSON.parse(raw))),danmaku=Array.from({length:4000},(_,at)=>({at,text:'测试弹幕'})),creatorSongs=[{id:'song'}];
  for(let i=0;i<500;i++)bridge.publish({page:'creator',danmaku,creatorSongs,video:{status:i%2?'playing':'ready'}});
  assert.equal(messages[0].danmaku.length,4000);assert.ok(messages.slice(1).every(value=>!('danmaku' in value) && !('creatorSongs' in value)));
});
test('Bilibili segment and collection lists only cross Wasm once while playback clocks change',()=>{
  const messages=[],bridge=new SnapshotBridge(raw=>messages.push(JSON.parse(raw))),biliParts=Array.from({length:1000},(_,id)=>({id})),biliCollectionSongs=Array.from({length:2000},(_,id)=>({id}));
  for(let i=0;i<1000;i++)bridge.publish({page:'home',biliParts,biliCollectionSongs,status:i%2?'playing':'paused'});
  assert.equal(messages[0].biliParts.length,1000);assert.equal(messages[0].biliCollectionSongs.length,2000);assert.ok(messages.slice(1).every(row=>!('biliParts' in row) && !('biliCollectionSongs' in row)));
});
test('large dynamic documents and followed authors are not retransferred on scalar playback updates',()=>{
  const messages=[],bridge=new SnapshotBridge(raw=>messages.push(raw)),activities=Array.from({length:300},(_,id)=>({id,text:'动态文字'.repeat(100),original:{text:'转发内容'.repeat(100)}})),activityDetails=[activities[0]],followingCreators=Array.from({length:300},(_,id)=>({id,name:'UP 主'}));
  for(let i=0;i<1000;i++)bridge.publish({page:'following',activities,activityDetails,followingCreators,status:i%2?'playing':'paused'});
  assert.ok(messages[0].length>200000);assert.ok(messages.slice(1).every(raw=>raw.length<100));
});

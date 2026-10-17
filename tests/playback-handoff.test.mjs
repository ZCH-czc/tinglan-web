import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeHandoff,handoffIdentity,handoffTrack,buildHandoff,handoffPlan,handoffExpired,HANDOFF_LIMITS} from '../web/playback-handoff.mjs';
import {bilibiliPartId} from '../web/bilibili-id.mjs';
const now=1700000000000;
const row={id:'qq:track:001AbCdefghij',title:'海风',artist:'听岚',duration:100};
const native=()=>({sessionId:'native-session',deviceId:'android-device',deviceName:'车机',updatedAt:now,tracks:[{...row}],index:0,positionMs:12345});
test('Android v1 default version/artwork omissions decode and Web exports the same stable track namespaces',()=>{
  const snapshot=normalizeHandoff(native(),{now});assert.equal(snapshot.version,1);assert.equal(snapshot.tracks[0].artwork,null);assert.equal(snapshot.positionMs,12345);
  const plan=handoffPlan(snapshot,{now});assert.equal(plan.currentId,'qq-001AbCdefghij');assert.equal(plan.tracks[0].source,'qq');assert.equal(handoffTrack(plan.tracks[0]).id,row.id);
  for(const [id,source] of [['netease:track:123','netease'],['bili:video:BV1xx411c7mD','bili'],['bili:video:'+bilibiliPartId('BV1xx411c7mD','987654321012345678'),'bili']])assert.equal(handoffIdentity(id).source,source);
});
test('handoff uses the Android forty-item window, skips local files and rebases its current index',()=>{
  const queue=Array.from({length:70},(_,i)=>({id:'qq-001Song'+String(i).padStart(4,'0'),source:'qq',title:'歌曲 '+i,artist:'音乐人',durationMs:120000}));for(const index of [21,25,28])queue[index]={id:'local-'+index,source:'local'};
  const snapshot=buildHandoff(queue,queue[30].id,33333,{deviceId:'web-device',deviceName:'浏览器',sessionId:'session',now});assert.equal(snapshot.tracks.length,37);assert.equal(snapshot.index,7);assert.equal(snapshot.tracks[snapshot.index].title,'歌曲 30');assert.equal(snapshot.positionMs,33333);
  assert.throws(()=>buildHandoff(queue,'local-21',0,{deviceId:'d',deviceName:'n',sessionId:'s',now}),/unsupported|does not support|cannot/i);
});
test('metadata limits, index, future timestamps and playback bounds reject invalid remote records',()=>{
  const base=native();for(const patch of [{version:2},{deviceName:''},{sessionId:'x'.repeat(65)},{updatedAt:now+300001},{index:-1},{index:1},{positionMs:100001},{tracks:[]},{tracks:Array(41).fill(row)}])assert.throws(()=>normalizeHandoff({...base,...patch},{now}));
  for(const patch of [{title:''},{title:'x'.repeat(513)},{artist:'x'.repeat(513)},{duration:86401},{duration:.1},{id:'local:file:a'},{id:'qq:playlist:123'},{id:'bili:video:BVbad'},{artwork:'http://i0.hdslb.com/a.jpg'}])assert.throws(()=>normalizeHandoff({...base,tracks:[{...row,...patch}]},{now}));
});
test('whitelisting strips credentials/local data and rejects unsafe artwork while preserving platform art',()=>{
  const value={...native(),password:'fixture-only',cookie:'fixture-only',tracks:[{...row,authorization:'fixture-only',lyrics:'private notes',filename:'file.mp3',artwork:'https://user:pass@y.gtimg.cn/a.jpg'}]};
  const snapshot=normalizeHandoff(value,{now});assert.equal(snapshot.tracks[0].artwork,null);assert.doesNotMatch(JSON.stringify(snapshot),/fixture-only|private notes|file.mp3/);
  value.tracks[0].artwork='https://y.gtimg.cn/cover.jpg';assert.equal(normalizeHandoff(value,{now}).tracks[0].artwork,value.tracks[0].artwork);
});
test('old valid records retain their structure for conditional replacement, and cannot be resumed',()=>{
  const value={...native(),updatedAt:now-HANDOFF_LIMITS.age-1};assert.throws(()=>normalizeHandoff(value,{now}));assert.equal(normalizeHandoff(value,{now,allowExpired:true}).updatedAt,value.updatedAt);assert.equal(handoffExpired(value,now),true);assert.throws(()=>handoffPlan(value,{now}));
});
test('duplicate Android queues retain their occurrence and import metadata only once',()=>{
  const value={...native(),tracks:[row,{...row,title:'当前条目的标题'}],index:1};const snapshot=normalizeHandoff(value,{now}),plan=handoffPlan(snapshot,{now});
  assert.equal(snapshot.tracks.length,2);assert.equal(snapshot.index,1);assert.deepEqual(plan.ids,['qq-001AbCdefghij','qq-001AbCdefghij']);assert.equal(plan.index,1);
  assert.equal(plan.metadata.length,1);assert.equal(plan.metadata[0].title,'当前条目的标题');assert.equal(plan.position,12345);
});

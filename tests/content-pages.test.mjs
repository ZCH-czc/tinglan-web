import test from 'node:test';import assert from 'node:assert/strict';
import {ContentPages,collectPlaylist} from '../web/content-pages.mjs';
import {PlatformClient} from '../web/platform-client.mjs';
import {parseCollectionLink} from '../web/collection-links.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('fresh reply parent data wins over an older main comment and cannot leak between subjects',async()=>{
  const pages=new ContentPages(async request=>request.root?{parent:{id:request.root,text:'平台返回的最新原评论'},items:[{id:'reply',text:'楼中楼'}]}:{items:[{id:'root',text:'旧预览'}]},()=>{});
  await pages.select({id:'bili-one'});await pages.select({id:'bili-one',root:'root'});assert.equal(pages.findComment('root','bili-one').text,'平台返回的最新原评论');assert.equal(pages.findComment('root','bili-two'),undefined);
  await pages.select({id:'bili-one'});assert.equal(pages.findComment('reply','bili-one').text,'楼中楼');pages.clear();assert.equal(pages.findComment('root','bili-one'),undefined);
});

test('content navigation ignores late replies and returns to cached comments without refreshing',async()=>{
  const requests=[];let shown;const pages=new ContentPages((request,options)=>{const d=deferred();requests.push({...d,request,signal:options.signal});return d.promise;},state=>shown=state);
  const first=pages.select({id:'bili-one',root:''}),second=pages.select({id:'bili-two',root:''});assert.equal(requests[0].signal.aborted,true);
  requests[1].resolve({items:[{id:'current',text:'当前'}],next:''});await second;requests[0].resolve({items:[{id:'stale'}]});await first;
  assert.equal(shown.items[0].id,'current');await pages.select({id:'bili-two',root:''});assert.equal(requests.length,2);assert.equal(shown.loading,false);
  const third=pages.select({id:'qq-third'});pages.cancel();requests[2].resolve({items:[{id:'late'}]});await third;assert.equal(shown.items.length,0);assert.equal(pages.cache.size,1);
});
test('reply parent lookup is scoped to its song and retained pages are bounded',async()=>{
  let fail=false,shown;const pages=new ContentPages(async request=>{if(fail)throw new Error('offline');return {items:[{id:'same',text:request.id}],songs:[{id:request.id}]};},state=>shown=state,{limit:3});
  await pages.select({id:'bili-one'});await pages.select({id:'qq-two'});assert.equal(pages.findComment('same','bili-one').text,'bili-one');assert.equal(pages.findComment('same','qq-two').text,'qq-two');
  await pages.select({id:'bili-three'});await pages.select({id:'bili-four'});assert.equal(pages.cache.size,3);assert.equal(pages.findComment('same','bili-one'),undefined);
  fail=true;await pages.select({id:'bili-four'},{force:true});assert.equal(shown.items[0].text,'bili-four');assert.equal(shown.warning,'offline');assert.equal(shown.loading,false);
  pages.clear();assert.equal(pages.current,null);assert.deepEqual(pages.retainedSongs(),[]);
});
test('complete platform links resolve IDs without accepting arbitrary fetch destinations or credentials',()=>{
  const cases=[['https://y.qq.com/n/ryqq/playlist/123','qq','123'],['https://music.163.com/#/playlist?id=456','netease','456'],['https://space.bilibili.com/123/favlist?fid=789','bili','789'],['https://www.bilibili.com/medialist/detail/ml789','bili','789'],['https://space.bilibili.com/123/lists/456?type=season','bili','season_456'],['bili:season_123','bili','season_123']];
  for(const [input,source,id] of cases)assert.deepEqual(parseCollectionLink(input),{source,id});
  for(const input of ['https://attacker.test/playlist/123','https://music.163.com.evil.test/#/playlist?id=12','https://user:test@y.qq.com/playlist/123','https://y.qq.com:444/playlist/123','javascript:alert(1)','https://music.163.com/song?id=123','bili:season_0','qq:../123'])assert.equal(parseCollectionLink(input),null);
  assert.deepEqual(parseCollectionLink('123','netease'),{source:'netease',id:'123'});assert.equal(parseCollectionLink('9'.repeat(50)),null);
});
test('playlist collection reaches every page in order and deduplicates overlapping songs',async()=>{
  const pages=[],progress=[],playlist={source:'qq',id:'123',title:'完整歌单'};
  const value=await collectPlaylist(async request=>{pages.push(request.page);return {playlist,songs:request.page===1?[{id:'a'},{id:'b'}]:[{id:'b'},{id:'c'}],total:4,unavailable:request.page===2?1:0,more:request.page<2};},{source:'qq',id:'123'},{progress:value=>progress.push(value)});
  assert.deepEqual(pages,[1,2]);assert.deepEqual(value.songs.map(song=>song.id),['a','b','c']);assert.equal(value.unavailable,1);assert.equal(progress.at(-1).received,3);
});
test('interrupted, malformed and repeated platform pages never produce a plan to commit',async()=>{
  const request={source:'qq',id:'123'},playlist=request;let writes=0;
  const apply=async load=>{const plan=await collectPlaylist(load,request);++writes;return plan;};
  await assert.rejects(apply(async r=>{if(r.page===2)throw new Error('network');return {playlist,songs:[{id:'a'}],more:true,total:2};}),/network/);
  await assert.rejects(apply(async()=>({playlist,songs:[{id:'a'}],more:true,total:2})),/repeated|duplicate/i);
  await assert.rejects(apply(async()=>({playlist:{source:'qq',id:'999'},songs:[],more:false})),/identifier/i);
  await assert.rejects(apply(async()=>({playlist,songs:[],more:true,total:2})),/empty page/i);
  await assert.rejects(apply(async()=>({playlist,songs:[],more:false,total:10001})),/capacity/i);
  const controller=new AbortController();await assert.rejects(collectPlaylist(async()=>{controller.abort();return {playlist,songs:[{id:'a'}],more:false};},request,{signal:controller.signal}),error=>error.name==='AbortError');assert.equal(writes,0);
});
test('song and author searches use distinct persistent cache keys and pending content stops after account changes',async()=>{
  const keys=[],client=new PlatformClient({read:async(_,key)=>{keys.push(key);return key.endsWith('|creators')?{creators:[{id:'artist'}]}:{songs:[{id:'song'}]};}},{fetcher:()=>assert.fail('cached navigation fetched')});
  assert.equal((await client.catalog('qq','same',1,{kind:'songs'})).songs[0].id,'song');assert.equal((await client.catalog('qq','same',1,{kind:'creators'})).creators[0].id,'artist');assert.notEqual(keys[0],keys[1]);
  const d=deferred(),pendingClient=new PlatformClient({read:async()=>null,cacheCatalog:async()=>assert.fail('old content cached'),clearCatalog:async()=>{}},{fetcher:url=>url==='/api/account'?Promise.resolve(Response.json({ok:true})):url==='/api/accounts'?Promise.resolve(Response.json({revision:'a'.repeat(32),accounts:[]})):d.promise});
  const pending=pendingClient.comments({id:'bili-one'}).catch(e=>e);await new Promise(r=>setImmediate(r));await pendingClient.account('bili','');d.resolve(Response.json({items:[{id:'stale'}]}));assert.equal((await pending).name,'AbortError');
});

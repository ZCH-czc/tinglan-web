import test from 'node:test';import assert from 'node:assert/strict';
import { creatorProfile,creatorSongs,validCreator } from '../server/creators.mjs';
import { mapQq,mapBili,mapNetease,PlatformProviders } from '../server/providers.mjs';
import { CreatorPages } from '../web/creator-pages.mjs';
import { PlatformClient } from '../web/platform-client.mjs';
import { normalizeTrack } from '../web/library-data.mjs';
import { createServer } from 'node:http';
import { createGateway } from '../server/gateway.mjs';
import { PlatformError } from '../server/upstream.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
test('song mappings and saved metadata preserve canonical creator IDs for all three platforms',()=>{
  assert.equal(mapQq({mid:'001AbCdefghij',singer:[{mid:'001Artist',name:'音乐人'}]}).creatorId,'001Artist');
  assert.equal(mapBili({bvid:'BV1xx411c7mD',owner:{mid:123,name:'UP 主'}}).creatorId,'123');
  const net=mapNetease({id:123,ar:[{id:321,name:'音乐人'}]});assert.equal(net.creatorId,'321');
  assert.equal(normalizeTrack({...net,cached:false,size:0}).creatorId,'321');
  for(const [source,id] of [['bili','../123'],['qq','123?evil'],['netease','0'],['foreign','123']])assert.equal(validCreator(source,id),false);
});
test('Bilibili author profiles and uploads retain the expected owner and sanitise untrusted biography and avatar',async()=>{
  const calls=[],p={bili:async(path,q)=>{calls.push(q);return path.endsWith('/card')?{data:{follower:12,card:{mid:'123',name:'UP',sign:'<p>简介</p>',face:'https://attacker.test/avatar'}}}:{data:{list:{vlist:[{bvid:'BV1xx411c7mD',title:'海风',length:'02:03',author:'UP'}]},page:{count:61}}};}};
  const profile=await creatorProfile(p,'bili','123');assert.equal(profile.description,'简介');assert.equal(profile.avatarUrl,'');assert.equal(profile.followers,12);
  const page=await creatorSongs(p,'bili','123',2);assert.equal(page.songs[0].durationMs,123000);assert.equal(page.songs[0].creatorId,'123');assert.equal(page.more,true);assert.equal(calls[1].pn,2);
  await assert.rejects(creatorProfile(p,'bili','999'),e=>e.code==='invalid-response');await assert.rejects(creatorSongs(p,'bili','123',101),e=>e.code==='invalid-request');
});
test('QQ and NetEase artist profiles and pagination use separate canonical protocols',async()=>{
  const calls=[],p={qq:async(module,method,q)=>{calls.push({module,method,q});return method==='GetSingerDetail'?{singer_list:[{basic_info:{singer_mid:'001Artist',singer_name:'歌手'},ex_info:{desc:'介绍'}}]}:{singerMid:'001Artist',totalNum:31,songList:[{songInfo:{mid:'001AbCdefghij',title:'海风',singer:[{mid:'001Artist',name:'歌手'}]}}]};},netease:async(path,q)=>{calls.push({path,q});return path.includes('/songs')?{songs:[{id:123,name:'海风',ar:[{id:1,name:'歌手'}]}],total:31,more:true}:{artist:{id:1,name:'歌手',briefDesc:'介绍',picUrl:'https://p1.music.126.net/a.jpg'}};}};
  assert.equal((await creatorProfile(p,'qq','001Artist')).name,'歌手');assert.equal((await creatorSongs(p,'qq','001Artist',1)).more,true);assert.equal(calls[1].q.begin,0);
  assert.equal((await creatorProfile(p,'netease','1')).name,'歌手');assert.equal((await creatorSongs(p,'netease','1',2)).songs.length,1);assert.equal(calls.at(-1).q.offset,30);
});
test('QQ singer profiles include the existing Android client protocol fields without changing the web search protocol',async()=>{
  const bodies=[],p=new PlatformProviders({json:async(s,url,options)=>{bodies.push(JSON.parse(options.body));return {code:0,req_0:{code:0,data:{singer_list:[{basic_info:{singer_mid:'001Artist',name:'歌手'}}]}}};}});
  await creatorProfile(p,'qq','001Artist',{cookies:{}});await p.qq('search','DoSearch',{}, {cookies:{}});
  assert.equal(bodies[0].comm.ct,'11');assert.equal(bodies[0].comm.cv,'14090008');assert.equal(bodies[0].comm.tmeAppID,'qqmusic');assert.equal(bodies[0].req_0.param.singer_mids[0],'001Artist');assert.equal(bodies[1].comm.ct,'24');assert.equal(bodies[1].comm.platform,'yqq.json');
});
test('rapid author navigation, request cancellation and cached return cannot expose stale profiles',async()=>{
  const requests=[];let current;const pages=new CreatorPages((source,id,page,options)=>{const d=deferred();requests.push({...d,id,signal:options.signal});return d.promise;},state=>current=state);
  const old=pages.select('bili','123'),latest=pages.select('qq','001Artist');assert.equal(requests[0].signal.aborted,true);
  requests[1].resolve({profile:{name:'新作者'},songs:[{id:'current'}]});await latest;requests[0].resolve({profile:{name:'旧作者'},songs:[{id:'old'}]});await old;
  assert.equal(current.profile.name,'新作者');await pages.select('qq','001Artist');assert.equal(requests.length,2);assert.equal(current.songs[0].id,'current');
  const pending=pages.select('bili','456');pages.clear();requests.at(-1).reject(new Error('late'));await pending;assert.equal(pages.cache.size,0);assert.equal(pages.current,null);
});
test('retained author pages stay bounded and explicit refresh failures preserve already loaded rows',async()=>{
  let fail=false,current;const pages=new CreatorPages(async(s,id,page)=>{if(fail)throw new Error('offline');return {profile:{name:id},songs:[{id:'song-'+id}],page};},state=>current=state);
  for(let i=1;i<=25;i++)await pages.select('bili',String(i));assert.equal(pages.cache.size,12);assert.equal(pages.retainedSongs().length,12);
  fail=true;await pages.select('bili','25',1,{force:true});assert.equal(current.songs[0].id,'song-25');assert.match(current.warning,/offline/);assert.equal(current.loading,false);
});
test('persistent author caches avoid automatic refresh, and account changes invalidate pending replies',async()=>{
  let count=0;const client=new PlatformClient({read:async()=>({profile:{name:'已保存'},songs:[]}),cacheCatalog:async()=>{}},{fetcher:async()=>{++count;throw new Error('offline');}});
  assert.equal((await client.creator('bili','123')).profile.name,'已保存');assert.equal(count,0);assert.match((await client.creator('bili','123',1,{force:true})).warning,/previous/i);
  const d=deferred();const next=new PlatformClient({read:async()=>null,cacheCatalog:async()=>assert.fail('stale cache write'),clearCatalog:async()=>{}},{fetcher:url=>url==='/api/account'?Promise.resolve(Response.json({ok:true})):url==='/api/accounts'?Promise.resolve(Response.json({revision:'a'.repeat(32),accounts:[]})):d.promise});
  const pending=next.creator('bili','123').catch(e=>e);await new Promise(r=>setImmediate(r));await next.account('bili','');d.resolve(Response.json({profile:{name:'old'},songs:[]}));assert.equal((await pending).name,'AbortError');
});
test('author gateway preserves profiles on upload verification errors and restricts avatar requests to public CDN headers',async()=>{
  let mediaOptions,calls=0;const providers={headers:()=>({Referer:'https://y.qq.com/'}),qq:async(_,method)=>{++calls;if(method==='GetSingerSongList')throw new PlatformError('verification','平台要求验证',429);return {singer_list:[{basic_info:{singer_mid:'001Artist',name:'歌手'},pic:{pic:'https://y.gtimg.cn/artist.jpg'}}]};}};
  const gateway=createGateway({providers,fetcher:async(_,options)=>{mediaOptions=options;return new Response('image',{headers:{'Content-Type':'image/jpeg'}});}}),server=createServer((req,res)=>gateway(req,res));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const response=await fetch(base+'/api/creator?source=qq&id=001Artist');const cookie=response.headers.get('set-cookie').split(';')[0],value=await response.json();assert.equal(value.profile.name,'歌手');assert.match(value.warning,/验证/);assert.deepEqual(value.songs,[]);
    const invalid=await fetch(base+'/api/creator?source=bili&id=../123',{headers:{Cookie:cookie}});assert.equal(invalid.status,400);assert.equal(calls,2);
    const image=await fetch(base+'/api/creator-artwork?source=qq&id=001Artist',{headers:{Cookie:cookie}});assert.equal(image.status,200);await image.arrayBuffer();assert.equal(mediaOptions.headers.Cookie,undefined);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('account changes during an author profile request invalidate its reply before exposing stale rows',async()=>{
  const profile=deferred();let started;const ready=new Promise(r=>started=r),providers={qq:async()=>{started();return profile.promise;},headers:()=>({})};const gateway=createGateway({providers}),server=createServer((req,res)=>gateway(req,res));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  try{const health=await fetch(base+'/api/health');const cookie=health.headers.get('set-cookie').split(';')[0];await health.json();const headers={Cookie:cookie};const pending=fetch(base+'/api/creator?source=qq&id=001Artist',{headers});await ready;
    const update=await fetch(base+'/api/account',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({source:'qq',cookie:''})});await update.json();profile.resolve({singer_list:[{basic_info:{singer_mid:'001Artist',name:'old'}}]});assert.equal((await pending).status,409);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('available author songs remain accessible when the detailed profile endpoint is unavailable',async()=>{
  const p={headers:()=>({}),qq:async(_,method)=>{if(method==='GetSingerDetail')throw new PlatformError('unavailable','资料接口暂不可用');return {songList:[{songInfo:{mid:'001AbCdefghij',singer:[{mid:'001Artist',name:'歌手'}]}}],totalNum:1};}};
  const gateway=createGateway({providers:p}),server=createServer((req,res)=>gateway(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/creator?source=qq&id=001Artist`);assert.equal(r.status,200);const value=await r.json();assert.equal(value.songs.length,1);assert.equal(value.profile.name,'歌手');assert.equal(value.profile.partial,true);assert.match(value.warning,/资料/);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

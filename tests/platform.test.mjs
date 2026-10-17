import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { RequestGovernor,safeHttps } from '../server/upstream.mjs';
import { mapQq,mapBili,mapNetease,neteaseForm,PlatformProviders } from '../server/providers.mjs';
import { createGateway } from '../server/gateway.mjs';

test('platform mappings preserve Unicode, remove highlighted markup and reject invalid IDs',()=>{
  const qq=mapQq({mid:'001AbCdefghij',title:'海风',singer:[{name:'听岚'}],album:{mid:'002Album123',title:'航线'},interval:12});assert.equal(qq.id,'qq-001AbCdefghij');assert.equal(qq.durationMs,12000);
  const bili=mapBili({bvid:'BV1xx411c7mD',title:'<em class="keyword">海风</em> &amp; 现场',author:'UP',duration:'01:02',pic:'//i0.hdslb.com/cover.jpg'});assert.equal(bili.title,'海风 & 现场');assert.equal(bili.durationMs,62000);
  const net=mapNetease({id:123,name:'海风',ar:[{name:'听岚'}],al:{name:'航线',picUrl:'https://p1.music.126.net/cover.jpg'},dt:12_000});assert.equal(net.artist,'听岚');assert.equal(mapBili({bvid:'../../etc/passwd'}),null);assert.equal(mapQq({mid:'a'}),null);assert.equal(mapNetease({id:-1}),null);
});
test('trusted resource domains reject credentials, local addresses, deceptive suffixes and non-HTTPS schemes',()=>{
  assert.equal(safeHttps('https://local.test@isure.stream.qqmusic.qq.com/music.mp3',['qqmusic.qq.com']),null);assert.equal(safeHttps('https://qqmusic.qq.com.attacker.test/music.mp3',['qqmusic.qq.com']),null);assert.equal(safeHttps('https://127.0.0.1/music.mp3',['qqmusic.qq.com']),null);assert.equal(safeHttps('file:///etc/passwd',['qqmusic.qq.com']),null);assert.equal(safeHttps('https://isure.stream.qqmusic.qq.com/music.mp3',['qqmusic.qq.com']),'https://isure.stream.qqmusic.qq.com/music.mp3');
});
test('NetEase public protocol is deterministic with a fixed key and generates distinct session encryption keys',()=>{
  const a=neteaseForm({s:'海风'},'1234567890abcdef');const b=neteaseForm({s:'海风'},'1234567890abcdef');assert.equal(a.toString(),b.toString());assert.equal(a.get('encSecKey').length,256);assert.match(a.get('params'),/^[A-Za-z0-9+/]+=*$/);assert.notEqual(neteaseForm({s:'海风'}).get('encSecKey'),neteaseForm({s:'海风'}).get('encSecKey'));
});
test('concurrent equivalent requests share one upstream call and retain cached results',async()=>{
  let count=0;const net=new RequestGovernor({gap:0,fetcher:async()=>{++count;await new Promise(r=>setTimeout(r,5));return Response.json({code:0,data:[]})}});
  const results=await Promise.all(Array.from({length:20},()=>net.json('qq','https://u.y.qq.com/test')));assert.equal(count,1);assert.equal(results.length,20);await net.json('qq','https://u.y.qq.com/test');assert.equal(count,1);
});
test('rate limits pause a provider without request storms or protocol cycling',async()=>{
  let count=0,time=1000;const net=new RequestGovernor({gap:0,now:()=>time,fetcher:async()=>{++count;return new Response('',{status:429,headers:{'Retry-After':'60'}})}});
  await assert.rejects(net.json('bili','https://api.bilibili.com/test'),e=>e.code==='verification');await assert.rejects(net.json('bili','https://api.bilibili.com/other'),e=>e.code==='cooldown');assert.equal(count,1);time+=60_001;await assert.rejects(net.json('bili','https://api.bilibili.com/other'));assert.equal(count,2);
});
test('verification and rights failures remain explicit and are not retried',async()=>{
  let count=0;const net=new RequestGovernor({gap:0,fetcher:async()=>{++count;return Response.json({code:301})}});await assert.rejects(net.json('netease','https://music.163.com/test'),e=>e.code==='sign-in');assert.equal(count,1);
});
test('anonymous Bilibili request identifiers are accepted only for the navigation endpoint',async()=>{
  const net=new RequestGovernor({gap:0,fetcher:async()=>Response.json({code:-101,data:{wbi_img:{}}})});
  assert.equal((await net.json('bili','https://api.bilibili.com/x/web-interface/nav',{},0,'test',[-101])).code,-101);
  await assert.rejects(net.json('bili','https://api.bilibili.com/needs-login'),e=>e.code==='sign-in');
  const challenged=new RequestGovernor({gap:0,fetcher:async()=>new Response('',{status:412})});
  await assert.rejects(challenged.json('bili','https://api.bilibili.com/x/web-interface/nav',{},0,'test',[-101]),e=>e.code==='verification');
});
test('QQ search reads current item_song fields and retains the platform pagination cursor',async()=>{
  const params=[];const p=new PlatformProviders({});p.qq=async(_,__,value)=>{params.push(value);return {body:{item_song:{items:[{mid:'001AbCdefghij',title:'海风'}],total_num:21}},meta:{nextpage:2,nextpage_start:{song:20}}};};
  const first=await p.search('qq','海风',1,{id:'test'});await p.search('qq','海风',2,{id:'test'});
  assert.equal(first.songs[0].title,'海风');assert.equal(first.total,21);assert.equal(first.more,true);
  assert.equal(params[0].grp,1);assert.equal(params[1].searchid,params[0].searchid);assert.deepEqual(params[1].page_start,{song:20});
});
test('QQ valid relative playback paths use its official CDN when sip is an empty list',async()=>{
  const p=new PlatformProviders({});p.qq=async()=>({sip:[],midurlinfo:[{purl:'M500test.mp3?public-token=test',result:0}]});
  const result=await p.stream({source:'qq',remoteId:'001AbCdefghij',mediaMid:'known'});
  assert.equal(new URL(result.urls[0]).hostname,'isure.stream.qqmusic.qq.com');
  p.qq=async()=>({sip:[],midurlinfo:[{purl:'https://attacker.test/audio',result:0}]});
  await assert.rejects(p.stream({source:'qq',remoteId:'001AbCdefghij',mediaMid:'known'}),e=>e.code==='invalid-response');
});
test('account generations cannot share pending or cached authenticated responses',async()=>{
  const identities=[];const p=new PlatformProviders({json:async(source,url,opts,ttl,identity)=>{identities.push(identity);return {code:0,data:{value:identity}};}});
  await p.bili('/test',{}, {id:'session',generation:0,cookies:{}});await p.bili('/test',{}, {id:'session',generation:1,cookies:{}});
  await p.bili('/test',{}, {id:'session',generation:1,authRevision:1,cookies:{}});
  assert.deepEqual(identities,['session:0:0','session:1:0','session:1:1']);
});
test('local gateway rejects foreign origins and arbitrary proxy URLs, while opaque media streams support byte ranges',async()=>{
  const song={id:'qq-001AbCdefghij',remoteId:'001AbCdefghij',source:'qq',title:'海风',artist:'听岚'};let seenRange='';
  const providers={headers:()=>({}),search:async()=>({songs:[song],more:false}),discover:async()=>({songs:[song],more:false}),stream:async()=>({urls:['https://isure.stream.qqmusic.qq.com/audio.mp3'],type:'audio/mpeg'}),lyrics:async()=>({text:'[00:01]海风'})};
  const handler=createGateway({providers,fetcher:async(url,options)=>{seenRange=options.headers.Range;return new Response('WAVE',{status:206,headers:{'Content-Type':'audio/mpeg','Content-Range':'bytes 0-3/4','Content-Length':'4'}})}});
  const server=createServer((req,res)=>handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base+'/api/health',{headers:{Origin:'https://attacker.test'}})).status,403);
    const catalog=await fetch(base+'/api/catalog?source=qq&q=海风');const cookie=catalog.headers.get('set-cookie').split(';')[0];assert.equal((await catalog.json()).songs[0].title,'海风');
    const result=await (await fetch(base+'/api/stream?id='+song.id,{headers:{Cookie:cookie}})).json();assert.match(result.url,/^\/api\/media\/[a-f0-9]{48}$/);
    const media=await fetch(base+result.url,{headers:{Cookie:cookie,Range:'bytes=0-3'}});assert.equal(media.status,206);assert.equal(await media.text(),'WAVE');assert.equal(seenRange,'bytes=0-3');
    assert.equal((await fetch(base+result.url)).status,410);assert.equal((await fetch(base+'/api/proxy?url=http://127.0.0.1')).status,400);
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r))}
});

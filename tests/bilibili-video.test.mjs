import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mapVideoStreams,parseDanmaku,biliVideo,biliDanmaku } from '../server/bilibili-video.mjs';
import { RequestGovernor } from '../server/upstream.mjs';
import { createGateway } from '../server/gateway.mjs';
import {isolatedLoopback} from './helpers/http.mjs';
const row={id:80,codecid:7,codecs:'avc1.640028',width:1920,height:1080,frameRate:'60000/1001',bandwidth:2_000_000,baseUrl:'https://upos-sz.bilivideo.com/video.mp4?expires=valid'};
const video={accept_quality:[80],accept_description:['1080P'],dash:{duration:123,video:[row]}};
test('video mappings preserve supported metadata while rejecting untrusted media and malformed dimensions',()=>{
  const streams=mapVideoStreams(video);assert.equal(streams[0].label,'1080P');assert.ok(streams[0].frameRate>59 && streams[0].frameRate<60);
  for(const patch of [{baseUrl:'https://attacker.test/media'},{codecs:'<script>'},{width:Infinity},{height:10000},{id:999}])assert.equal(mapVideoStreams({dash:{video:[{...row,...patch}]}}).length,0);
});
test('danmaku handles Unicode and XML entities as text, ignores unsupported modes and bounds accepted rows',()=>{
  const xml='<i><d p="1.25,1,25,123">海风 &amp; &lt;文字&gt; &#x1F3B5; &#X1F3B6;</d><d p="1,7,25,0">advanced</d><d p="0,5,25,16777215">顶部</d><d p="-1,1,25,0">invalid</d></i>';
  const items=parseDanmaku(xml);assert.equal(items.length,2);assert.equal(items[0].mode,5);assert.equal(items[1].at,1250);assert.equal(items[1].text,'海风 & <文字> 🎵 🎶');
  const rows=Array.from({length:5000},(_,i)=>`<d p="${i},1,25,16777215">${'a'.repeat(200)}</d>`).join('');const bounded=parseDanmaku(rows);assert.equal(bounded.length,4000);assert.equal(bounded[0].text.length,120);
});
test('video and danmaku use the same validated segment, and subtitle CDN requests omit account cookies',async()=>{
  const calls=[];let headers;
  const p={bili:async(path,q,s,signed)=>{calls.push({path,q,signed});return path.endsWith('/view')?{data:{bvid:'BV1xx411c7mD',pages:[{cid:123}],owner:{mid:1},title:'海风'}}:{data:video};},headers:()=>({Referer:'https://www.bilibili.com/'}),net:{text:async(urlSource,url,options)=>{headers=options.headers;assert.equal(url,'https://comment.bilibili.com/123.xml');return '<d p="1,1,25,0">海风</d>';}}};
  assert.equal((await biliVideo(p,{remoteId:'BV1xx411c7mD'},80,{cookies:{bili:'secret'}})).cid,123);assert.equal(calls[1].q.qn,80);assert.equal(calls[1].signed,true);
  assert.equal((await biliDanmaku(p,{remoteId:'BV1xx411c7mD'},{cookies:{bili:'secret'}})).items.length,1);assert.equal(headers.Cookie,undefined);
  p.bili=async()=>({data:{bvid:'BV1xx411c7mD',pages:[{cid:123}],dash:{video:[]}}});await assert.rejects(biliVideo(p,{remoteId:'BV1xx411c7mD'},80),e=>e.code==='rights');
});
test('text requests share the provider governor, cache and verification cooldown, while malformed JSON stays explicit',async()=>{
  let count=0;const net=new RequestGovernor({gap:0,fetcher:async()=>{++count;return new Response('<i></i>');}});
  await Promise.all([net.text('bili','https://comment.bilibili.com/1.xml'),net.text('bili','https://comment.bilibili.com/1.xml')]);assert.equal(count,1);
  await assert.rejects(net.json('bili','https://comment.bilibili.com/1.xml'),e=>e.code==='invalid-response');assert.equal(count,2);
  const challenged=new RequestGovernor({gap:0,fetcher:async()=>new Response('',{status:412})});await assert.rejects(challenged.text('bili','https://comment.bilibili.com/1.xml'),e=>e.code==='verification');await assert.rejects(challenged.json('bili','https://api.bilibili.com/a'),e=>e.code==='cooldown');
  for(const body of ['null','123','"invalid"'])await assert.rejects(new RequestGovernor({gap:0,fetcher:async()=>new Response(body)}).json('bili','https://api.bilibili.com/a'),e=>e.code==='invalid-response');
});
test('many video switches retain active audio tokens, hide upstream URLs and invalidate all resources on account changes',async()=>{
  const providers={headers:()=>({}),bili:async path=>path.endsWith('/view')?{data:{bvid:'BV1xx411c7mD',pages:[{cid:123}]}}:{data:video},stream:async()=>({urls:['https://upos-sz.bilivideo.com/audio.m4a'],type:'audio/mp4'})};
  const gateway=createGateway({providers,fetcher:async()=>new Response('data',{status:206,headers:{'Content-Length':'4','Content-Range':'bytes 0-3/4'}})});
  const server=createServer((req,res)=>gateway(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  const fetch=isolatedLoopback,statusResponse=isolatedLoopback;
  try {
    const health=await fetch(base+'/api/health');const cookie=health.headers.get('set-cookie').split(';')[0];await health.json();const headers={Cookie:cookie};
    const audio=await (await fetch(base+'/api/stream?id=bili-BV1xx411c7mD',{headers})).json();let latest;
    for(let i=0;i<100;i++){latest=await (await fetch(base+'/api/video?id=bili-BV1xx411c7mD&quality=80',{headers})).json();assert.ok(!JSON.stringify(latest).includes('bilivideo.com'));}
    assert.equal((await statusResponse(base+audio.url,{headers})).status,206);assert.equal((await statusResponse(base+latest.streams[0].url,{headers})).status,206);
    assert.equal((await statusResponse(base+'/api/video?id=bili-BV1xx411c7mD&quality=999',{headers})).status,400);
    const update=await fetch(base+'/api/account',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({source:'bili',cookie:''})});await update.json();
    assert.equal((await statusResponse(base+audio.url,{headers})).status,410);assert.equal((await statusResponse(base+latest.streams[0].url,{headers})).status,410);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createGateway} from '../server/gateway.mjs';
import {RequestGovernor} from '../server/upstream.mjs';
import {PlatformClient} from '../web/platform-client.mjs';

async function setup(t,{status=200,headers={},withGovernor=false}={}) {
  let time=1000,mediaCalls=0,sourceCalls=0,governedCalls=0;
  const net=new RequestGovernor({now:()=>time,gap:0,fetcher:async()=>{governedCalls++;return Response.json({code:0});}});
  const providers={headers:()=>({}),...(withGovernor?{net}:{}),stream:async()=>{sourceCalls++;return {urls:['https://isure.stream.qqmusic.qq.com/audio.mp3?signed-token=private-fixture'],type:'audio/mpeg'};}};
  const gateway=createGateway({providers,now:()=>time,fetcher:async()=>{mediaCalls++;return new Response(status===200?'MP3':'denied',{status,headers:{'content-type':'audio/mpeg',...headers}});}});
  const server=createServer((req,res)=>gateway(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`,grant=await fetch(base+'/api/stream?id=qq-001AbCdefghij'),cookie=grant.headers.get('set-cookie').split(';')[0],value=await grant.json();
  const request=(path,options={})=>fetch(base+path,{...options,headers:{Cookie:cookie,...options.headers}});
  return {base,value,request,net,counts:()=>({mediaCalls,sourceCalls,governedCalls}),advance:ms=>time+=ms};
}
test('owned diagnostics report the actual media failure without contacting the CDN again',async t=>{
  const c=await setup(t,{status:403});const failed=await c.request(c.value.url);assert.equal(failed.status,401);await failed.arrayBuffer();
  for(let i=0;i<5;i++){const reply=await c.request('/api/media-state?'+new URLSearchParams({path:c.value.url})),value=await reply.json();assert.equal(reply.headers.get('cache-control'),'no-store');assert.equal(value.failure.code,'rights');assert.equal(value.failure.status,401);assert.ok(!JSON.stringify(value).includes('private-fixture'));}
  assert.deepEqual(c.counts(),{mediaCalls:1,sourceCalls:1,governedCalls:0});
  const foreign=await fetch(c.base+'/api/media-state?'+new URLSearchParams({path:c.value.url}));assert.equal(foreign.status,410);await foreign.arrayBuffer();
  c.advance(30001);assert.equal((await (await c.request('/api/media-state?'+new URLSearchParams({path:c.value.url}))).json()).failure,null);
});
test('expired media grants and malformed paths are diagnosed locally',async t=>{
  const c=await setup(t);c.advance(1800001);
  assert.equal((await c.request('/api/media-state?'+new URLSearchParams({path:c.value.url}))).status,410);
  for(const path of ['https://example.com/api/media/'+''.padStart(48,'a'),'/api/media/../../file','/api/media/a'])assert.equal((await c.request('/api/media-state?'+new URLSearchParams({path}))).status,400);
  assert.deepEqual(c.counts(),{mediaCalls:0,sourceCalls:1,governedCalls:0});
});
test('CDN expiry stays distinguishable from authorization and does not leak signed media addresses',async t=>{
  for(const status of [404,410,416]){const c=await setup(t,{status});const reply=await c.request(c.value.url);assert.equal(reply.status,410);assert.equal((await reply.json()).error.code,'source-expired');const value=await (await c.request('/api/media-state?'+new URLSearchParams({path:c.value.url}))).json();assert.equal(value.failure.code,'source-expired');assert.equal(c.counts().mediaCalls,1);}
});
test('a CDN rate limit publishes its bounded delay and pauses normal platform requests',async t=>{
  const c=await setup(t,{status:429,headers:{'retry-after':'600'},withGovernor:true});const response=await c.request(c.value.url);assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'120');await response.arrayBuffer();
  const state=await (await c.request('/api/media-state?'+new URLSearchParams({path:c.value.url}))).json();assert.equal(state.failure.code,'verification');assert.equal(state.failure.retryAfter,120);
  await assert.rejects(c.net.json('qq','https://u.y.qq.com/test'),e=>e.code==='cooldown');assert.equal(c.counts().governedCalls,0);
  for(let i=0;i<10;i++){const denied=await c.request(c.value.url);assert.equal(denied.status,429);await denied.arrayBuffer();}assert.equal(c.counts().mediaCalls,1,'CDN requests remain blocked even when a user repeatedly requests the same grant');
  c.advance(120001);await c.net.json('qq','https://u.y.qq.com/test');assert.equal(c.counts().governedCalls,1);
});
test('a successful media response has no failure and diagnostic reads never resolve a new source',async t=>{
  const c=await setup(t);await (await c.request(c.value.url)).arrayBuffer();assert.deepEqual(await (await c.request('/api/media-state?'+new URLSearchParams({path:c.value.url}))).json(),{failure:null});assert.equal(c.counts().sourceCalls,1);assert.equal(c.counts().mediaCalls,1);
});
test('client source failures preserve HTTP status and cooldown and diagnostics target only the local route',async()=>{
  const calls=[],client=new PlatformClient({}, {fetcher:async(path,options)=>{calls.push({path,options});return Response.json({error:{code:'verification',message:'请稍后重试'}},{status:429,headers:{'retry-after':'60'}});}});
  await assert.rejects(client.source('qq-fixture'),e=>e.status===429 && e.code==='verification' && e.retryAfter===60);
  assert.deepEqual(await client.mediaState('https://unrelated.test/not-media'),{failure:null});assert.equal(calls.length,1);
  const controller=new AbortController();await assert.rejects(client.mediaState('http://localhost/api/media/'+'a'.repeat(48),controller.signal),e=>e.code==='verification');
  assert.match(calls[1].path,/^\/api\/media-state\?path=/);assert.equal(calls[1].options.credentials,'same-origin');
});

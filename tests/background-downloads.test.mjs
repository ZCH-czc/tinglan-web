import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {LibraryStore} from '../web/storage.mjs';
import {BackgroundDownloads} from '../web/background-downloads.mjs';
import {BackgroundDownloadClient} from '../web/background-download-client.mjs';
import {downloadAudio} from '../web/download-response.mjs';

const id='bili-BV1sample',path='/api/media/'+'a'.repeat(48),origin='https://tinglan.test/service-worker.mjs';
const wav=()=>{const bytes=new Uint8Array(64);bytes.set(new TextEncoder().encode('RIFF'));bytes.set(new TextEncoder().encode('WAVE'),8);return new Blob([bytes],{type:'audio/wav'});};
const response=()=>new Response(wav(),{headers:{'Content-Type':'audio/wav','Content-Length':'64'}});
const tick=()=>new Promise(r=>setImmediate(r));
async function until(predicate){for(let i=0;i<100;i++){if(await predicate())return;await tick();}assert.fail('asynchronous operation did not settle');}
async function fixture(options={}){
  globalThis.indexedDB=new IDBFactory();globalThis.self={location:{href:origin}};
  const store=new LibraryStore();await store.open();await store.putTrack({id,source:'bili',title:'测试音乐',size:0,cached:false});
  const requests=[],messages=[],notifications=[];
  const service=new BackgroundDownloads({store,registration:{},clients:{matchAll:async()=>[{postMessage:m=>{messages.push(m);if(m.type==='tinglan-background-start')Promise.resolve().then(async()=>{try{await service.registration.backgroundFetch.fetch(m.bgId,[new Request(new URL(m.path,origin),{credentials:'same-origin'})],{downloadTotal:m.total});service.started(m.token,true);}catch{service.started(m.token,false);}});}}]},locks:null,request:async url=>{requests.push(url);return {url:path}},fetcher:async()=>response(),notify:async(_,value,enabled)=>{if(enabled)notifications.push(value)},...options});
  return {store,service,requests,messages,notifications};
}
test('worker commits audio and lyrics, keeps concurrent edits, strips private download paths from messages',async()=>{
  const f=await fixture();try{
    await f.service.enqueue({id,notify:true,assets:{lyrics:{text:'[00:01]歌词',source:'bili'}}});await f.store.patchTrack(id,{favorite:true});await f.service.run();
    const track=await f.store.read('tracks',id);assert.equal(track.cacheMode,'download');assert.equal(track.favorite,true);assert.equal(track.lyrics,'[00:01]歌词');assert.equal((await f.store.read('media',id)).size,64);
    assert.equal((await f.service.rows())[0].status,'complete');assert.equal(f.messages.at(-1).rows[0].progress,1);assert.equal(JSON.stringify(f.messages).includes(path),false);assert.equal(f.notifications.length,1);assert.ok(f.requests.includes('/api/cache-revoke'));
  }finally{f.store.db.close();}
});
test('100 duplicate clicks share a persisted job; the bounded queue rejects overflow without corrupting storage',async()=>{
  const f=await fixture();try{
    const jobs=await Promise.all(Array.from({length:100},()=>f.service.enqueue({id})));assert.equal(new Set(jobs.map(j=>j.token)).size,1);
    for(let i=0;i<20;i++){const next='bili-item'+i;await f.store.putTrack({id:next,title:next});if(i<19)await f.service.enqueue({id:next});else await assert.rejects(f.service.enqueue({id:next}),/full/i);}
    assert.equal((await f.service.rows()).length,20);await f.service.cancel();assert.ok((await f.service.rows()).every(r=>r.status==='cancelled'));
  }finally{f.store.db.close();}
});
test('background fetch survives a worker instance replacement and saves only on successful completion',async()=>{
  const registrations=new Map(),calls=[];
  const registration={backgroundFetch:{get:async key=>registrations.get(key),fetch:async(key,requests,options)=>{calls.push({requests,options});registrations.set(key,{id:key,match:async()=>({responseReady:Promise.resolve(response())}),abort:async()=>registrations.delete(key)});}}};
  const f=await fixture({registration});try{
    await f.service.enqueue({id});await f.service.run();assert.equal(calls.length,1);assert.equal(calls[0].requests[0].credentials,'same-origin');assert.equal(await f.store.read('media',id),undefined);
    const restarted=new BackgroundDownloads({store:f.store,registration,clients:{matchAll:async()=>[]},locks:null,request:async()=>({})});await restarted.run();assert.equal((await restarted.rows())[0].status,'downloading');
    const key=(await restarted.rows())[0].bgId;await restarted.complete({type:'backgroundfetchsuccess',registration:registrations.get(key)});assert.equal((await restarted.rows())[0].status,'complete');assert.equal((await f.store.read('media',id)).size,64);
  }finally{f.store.db.close();}
});
test('cancellation aborts streamed bytes and cannot leave partial audio or a stale completed notification',async()=>{
  let reading=false,cancelled=false;const f=await fixture({fetcher:async()=>new Response(new ReadableStream({start(){reading=true},cancel(){cancelled=true}}),{headers:{'Content-Type':'audio/wav'}})});
  try{await f.service.enqueue({id,notify:true});const running=f.service.run();await until(()=>reading && f.service.controllers.size>0);await f.service.cancel(id);await running;assert.equal(cancelled,true);assert.equal(await f.store.read('media',id),undefined);assert.equal((await f.service.rows())[0].status,'cancelled');assert.equal(f.notifications.length,0);}finally{f.store.db.close();}
});
test('cancelled background success never saves; old tokens cannot cancel a newer job',async()=>{
  const f=await fixture();try{
    const old=await f.service.enqueue({id});await f.service.update(old,{status:'downloading',bgId:'old',path});await f.service.cancel(id,old.token);const fresh=await f.service.enqueue({id});await f.service.cancel(id,old.token);
    await f.service.complete({type:'backgroundfetchsuccess',registration:{id:'old',match:async()=>assert.fail('cancelled response read')}});
    assert.equal((await f.service.rows())[0].token,fresh.token);assert.equal((await f.service.rows())[0].status,'queued');assert.equal(await f.store.read('media',id),undefined);
  }finally{f.store.db.close();}
});
test('a terminated fallback task becomes explicitly retryable rather than silently stuck',async()=>{
  const f=await fixture();try{const job=await f.service.enqueue({id});await f.service.update(job,{status:'downloading',path});await f.service.run();assert.equal((await f.service.rows())[0].status,'error');assert.match((await f.service.rows())[0].error,/interrupted/i);assert.equal(await f.store.read('media',id),undefined);}finally{f.store.db.close();}
});
test('disabled notifications are respected even after the queued job opted in',async()=>{
  const f=await fixture();try{await f.service.enqueue({id,notify:true});await f.store.write(['settings'],tx=>tx.objectStore('settings').put(false,'systemNotifications'));await f.service.run();assert.equal(f.notifications.length,0);}finally{f.store.db.close();}
});
test('a browser refusing Background Fetch falls back to bounded worker processing',async()=>{
  const registration={backgroundFetch:{get:async()=>undefined,fetch:async()=>{throw new DOMException('disabled','NotAllowedError')}}};const f=await fixture({registration});try{await f.service.enqueue({id});await f.service.run();assert.equal((await f.service.rows())[0].status,'complete');assert.equal((await f.store.read('media',id)).size,64);}finally{f.store.db.close();}
});

test('an accepted but stalled native transfer falls back once and ignores its delayed abort event',async()=>{
  let time=0,aborted=0;const entries=new Map();const registration={backgroundFetch:{get:async key=>entries.get(key),fetch:async key=>entries.set(key,{downloaded:0,result:'',abort:async()=>{aborted++;entries.delete(key)}})}};
  const f=await fixture({registration,now:()=>time});try{
    const job=await f.service.enqueue({id});await f.service.run();const bgId=(await f.service.rows())[0].bgId;
    time=1000;await f.service.fallback(job.token);assert.equal(aborted,0);
    time=31000;await f.service.fallback(job.token);assert.equal(aborted,1);assert.equal((await f.service.rows())[0].status,'queued');
    await f.service.complete({type:'backgroundfetchabort',registration:{id:bgId}});await f.service.run();
    assert.equal((await f.service.rows())[0].status,'complete');assert.equal((await f.store.read('media',id)).size,64);
    assert.equal(await f.service.update(job,{status:'queued'}),false);assert.equal((await f.service.rows())[0].status,'complete');
  }finally{f.store.db.close();}
});

test('active native progress is never restarted by the stalled-transfer fallback',async()=>{
  let time=0;const entries=new Map();const registration={backgroundFetch:{get:async key=>entries.get(key),fetch:async key=>entries.set(key,{downloaded:16,result:'',abort:async()=>assert.fail('progressing transfer aborted')})}};
  const f=await fixture({registration,now:()=>time});try{const job=await f.service.enqueue({id});await f.service.run();time=60000;await f.service.fallback(job.token);assert.equal((await f.service.rows())[0].status,'downloading');}finally{f.store.db.close();}
});

test('an unreadable native completion is retried through worker GET without saving empty audio',async()=>{
  const entries=new Map();let starts=0;const registration={backgroundFetch:{get:async key=>entries.get(key),fetch:async key=>{starts++;entries.set(key,{id:key,match:async()=>({responseReady:Promise.resolve(Response.error())})});}}};
  const f=await fixture({registration});try{await f.service.enqueue({id});await f.service.run();const bgId=(await f.service.rows())[0].bgId;await f.service.complete({type:'backgroundfetchsuccess',registration:entries.get(bgId)});assert.equal(starts,1);assert.equal((await f.service.rows())[0].status,'complete');assert.equal((await f.store.read('media',id)).size,64);}finally{f.store.db.close();}
});
test('the page starts native Background Fetch and acknowledges the worker without persisting credentials',async()=>{
  const old=globalThis.location;globalThis.location={href:origin};let started=0,ack;const registration={backgroundFetch:{get:async()=>undefined,fetch:async(bgId,requests)=>{started++;assert.equal(bgId,'tinglan-token');assert.equal(requests[0].url,new URL(path,origin).href);assert.equal(requests[0].credentials,'same-origin');}}};const client=new BackgroundDownloadClient({container:{ready:Promise.resolve(registration),addEventListener(){}}});client.call=async(action,data)=>{ack={action,...data}};
  try{await client.launch({id,token:'token',bgId:'tinglan-token',path,total:64,title:'音乐'});assert.equal(started,1);assert.deepEqual(ack,{action:'started',token:'token',ok:true});await client.launch({id,token:'token',bgId:'tinglan-token',path:'https://outside.test/file'});assert.equal(started,1);}finally{globalThis.location=old;}
});
test('download validation rejects HTML, forged audio, partial bytes and quota overflow',async()=>{
  for(const value of [new Response('<html>',{headers:{'Content-Type':'text/html'}}),new Response('fake',{headers:{'Content-Type':'audio/mp3'}}),new Response(wav(),{headers:{'Content-Type':'audio/wav','Content-Length':'65'}}),new Response(wav(),{status:206,headers:{'Content-Type':'audio/wav'}})])await assert.rejects(downloadAudio(value));
  await assert.rejects(downloadAudio(response(),{limit:32}));assert.equal((await downloadAudio(response())).size,64);
});

test('a CDN full-file 206 is accepted only with a complete, consistent range and byte count',async()=>{
  const headers={'Content-Type':'audio/wav','Content-Range':'bytes 0-63/64','Content-Length':'64'};
  assert.equal((await downloadAudio(new Response(wav(),{status:206,headers}))).size,64);
  for(const value of ['bytes 1-63/64','bytes 0-31/64','bytes 0-63/*','bytes 0-63/65'])await assert.rejects(downloadAudio(new Response(wav(),{status:206,headers:{...headers,'Content-Range':value}})));
  await assert.rejects(downloadAudio(new Response(wav(),{status:206,headers:{...headers,'Content-Length':'32'}})));
});
test('a new page-side preparation ignores the previous completed token and is cancellable before enqueue',async()=>{
  let finish;const client=new BackgroundDownloadClient({container:null,ensure:()=>new Promise(r=>finish=r),assets:async()=>({})});client.supported=true;client.call=async()=>({rows:[]});
  const promise=client.enqueue(id).catch(e=>e);await tick();client.accept([{id,token:'previous',status:'complete'}]);assert.equal(client.jobs.size,1);await client.cancel(id);assert.equal((await promise).name,'AbortError');finish();await tick();assert.equal(client.jobs.size,0);
});


test('compatibility fallback is remembered for following jobs instead of stalling each download again',async()=>{
  let native=0;const registration={backgroundFetch:{get:async()=>undefined,fetch:async()=>{native++;throw new Error('unavailable');}}};
  const f=await fixture({registration});try {await f.service.enqueue({id});await f.service.run();const next='bili-second';await f.store.putTrack({id:next,source:'bili',title:'第二首',cached:false,size:0});await f.service.enqueue({id:next});await f.service.run();assert.equal(native,1);assert.equal((await f.service.rows()).filter(r=>r.status==='complete').length,2);assert.ok(await f.store.read('settings','backgroundNativeRetryAt')>Date.now());}finally{f.store.db.close();}
});

test('fallback progress is durable and a replacement client receives progress even if the old page closed',async()=>{
  let at=1000,writer;const bytes=new Uint8Array(await wav().arrayBuffer()),newMessages=[];
  const f=await fixture({now:()=>at,fetcher:async()=>new Response(new ReadableStream({start(c){writer=c;c.enqueue(bytes.slice(0,32));}}),{headers:{'Content-Type':'audio/wav','Content-Length':'64'}})});
  try {await f.service.enqueue({id});const running=f.service.run();await until(async()=>(await f.service.rows())[0].done===32);
    f.service.clients.matchAll=async()=>[{postMessage(){throw new Error('closed page')}},{postMessage:m=>newMessages.push(m)}];await f.service.publish();assert.equal(newMessages[0].rows[0].done,32);
    at=2200;writer.enqueue(bytes.slice(32));writer.close();await running;assert.ok(newMessages.some(m=>m.type==='tinglan-download-progress' && m.done===64));assert.equal((await f.service.rows())[0].status,'complete');
  }finally{f.store.db.close();}
});

test('a restored page refreshes library metadata once when another worker completes a download',()=>{
  let commits=0;const client=new BackgroundDownloadClient({container:null,committed:()=>commits++});client.accept([{id,token:'job',status:'downloading'}]);client.accept([{id,token:'job',status:'complete'}]);client.accept([{id,token:'job',status:'complete'}]);assert.equal(commits,1);
});

test('preparing cache assets is immediately visible and cancellation removes the provisional row',async()=>{
  let finish;const changes=[];const client=new BackgroundDownloadClient({container:null,ensure:async()=>({title:'准备中的歌'}),assets:()=>new Promise(r=>finish=r),changed:rows=>changes.push(rows)});
  const pending=client.enqueue(id).catch(e=>e);assert.equal(changes.at(-1)[0].status,'preparing');await tick();assert.equal(changes.at(-1)[0].title,'准备中的歌');await client.cancel(id);assert.equal(changes.at(-1).length,0);finish({});assert.equal((await pending).name,'AbortError');
});


test('burst downloading serializes cover and lyric preparation and bounds pending work',async()=>{
  const gates=[],messages=[];let preparing=0,maximum=0;
  const client=new BackgroundDownloadClient({container:null,ensure:async id=>({id,title:id}),assets:async()=>{preparing++;maximum=Math.max(maximum,preparing);await new Promise(r=>gates.push(r));preparing--;return {};}});
  client.call=async(action,job)=>{messages.push(job.id);return {job:{token:job.id},rows:[{id:job.id,token:job.id,status:'complete'}]};};
  const jobs=Array.from({length:20},(_,i)=>client.enqueue('bili-burst'+i));await assert.rejects(client.enqueue('bili-overflow'),/full/i);await until(()=>gates.length===1);assert.equal(maximum,1);
  for(let i=0;i<20;i++){await until(()=>gates.length>i);gates[i]();await tick();}await Promise.all(jobs);assert.equal(messages.length,20);assert.equal(maximum,1);assert.equal(client.jobs.size,0);
});

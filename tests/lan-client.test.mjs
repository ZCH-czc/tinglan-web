import test from 'node:test';import assert from 'node:assert/strict';
import {LanTransferClient} from '../web/lan-transfer-client.mjs';import {LanUploader} from '../web/lan-sender.mjs';import {LAN_LIMITS} from '../web/lan-transfer-policy.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};},tick=()=>new Promise(resolve=>setImmediate(resolve));
const url='http://192.168.20.10:12345/#key='+'b'.repeat(64),row=()=>({id:'c'.repeat(48),name:'海风.wav',sha256:'d'.repeat(64),size:4,status:'pending',error:''}),value=(active=false)=>({intent:active?1:0,active,addresses:[{name:'Wi-Fi',address:'192.168.20.10'}],receipts:[],url:active?url:'',expiresAt:1700000600000,filename:'',receivedBytes:0,totalBytes:0});
function receiver(extra={}) {
  let server=value(false);const calls=[],timers=new Set(),imports=[];const platform={generation:0,accountRevision:'a'.repeat(32),request:async(path,options)=>{calls.push({path,options});if(path.endsWith('/start'))server=value(true);if(path.endsWith('/stop'))server={...value(false),intent:options.body.intent};if(path.endsWith('/ack'))server={...server,receipts:server.receipts.map(row=>row.id===options.body.id?{...row,status:options.body.ok?'imported':'failed',error:options.body.error || ''}:row)};return structuredClone(server);}};
  const client=new LanTransferClient({platform,encode:async()=>['10','01'],fetcher:async()=>new Response(new Blob(['WAVE'])),importFile:async(file,options)=>{imports.push({file,options});},schedule:fn=>{timers.add(fn);return fn},cancel:fn=>timers.delete(fn),...extra});
  return {client,platform,calls,timers,imports,setServer:v=>{server=v;}};
}

test('entering the page reads addresses without opening a port, then starts only after the explicit action',async()=>{
  const f=receiver();try{await f.client.open();assert.equal(f.client.state.active,false);assert.equal(f.calls.filter(row=>row.path.endsWith('/start')).length,0);assert.equal(f.timers.size,0);await f.client.start('192.168.20.10');assert.equal(f.client.state.active,true);assert.deepEqual(f.client.state.qrRows,['10','01']);assert.equal(f.timers.size,1);assert.doesNotMatch(JSON.stringify(f.client.view()),/b{64}|key=|qrRows/);await f.client.stop();assert.equal(f.client.state.active,false);assert.equal(f.timers.size,0);}finally{f.client.clear();}
});

test('100 rapid starts submit once; closing before acknowledgment prevents the late QR from reopening reception',async()=>{
  const f=receiver(),wait=deferred();await f.client.open();f.platform.request=async(path,options)=>{f.calls.push({path,options});return path.endsWith('/start')?wait.promise:{...value(false),intent:options?.body?.intent || 0};};
  const jobs=Array.from({length:100},()=>f.client.start('192.168.20.10'));assert.equal(f.calls.filter(row=>row.path.endsWith('/start')).length,1);await f.client.stop({leave:true});wait.resolve(value(true));await Promise.all(jobs);assert.equal(f.client.state.active,false);assert.equal(f.client.state.busy,false);assert.deepEqual(f.client.state.qrRows,[]);assert.equal(f.timers.size,0);f.client.clear();
});

test('100 out-of-order page opens cannot publish old connection state or private symbols',async()=>{
  const f=receiver(),requests=[];f.platform.request=(_path,options)=>{const d=deferred();requests.push({...d,options});return d.promise};const jobs=Array.from({length:100},()=>f.client.open());assert.ok(requests.slice(0,-1).every(row=>row.options.signal.aborted));requests.at(-1).resolve(value(false));for(const d of requests.slice(0,-1))d.resolve(value(true));await Promise.all(jobs);assert.equal(f.client.state.active,false);assert.equal(f.client.rawUrl,'');assert.equal(f.timers.size,0);f.client.clear();
});

test('a file is acknowledged only after its local import finishes; no overlapping import starts on repeated reads',async()=>{
  const wait=deferred(),f=receiver({importFile:async()=>wait.promise});try{await f.client.open();await f.client.start('192.168.20.10');f.setServer({...value(true),receipts:[row()]});await f.client.poll();await tick();assert.equal(f.client.state.importing,'海风.wav');assert.equal(f.calls.filter(call=>call.path.endsWith('/ack')).length,0);for(let i=0;i<100;i++)f.client.drain();wait.resolve();await f.client.importing;assert.equal(f.calls.filter(call=>call.path.endsWith('/ack') && call.options.body.ok).length,1);assert.equal(f.client.state.receipts[0].status,'imported');}finally{f.client.clear();}
});

test('leaving during a file read aborts bytes and prevents a late import or acknowledgment',async()=>{
  const wait=deferred(),f=receiver({fetcher:async(_url,options)=>{assert.equal(options.credentials,'same-origin');return wait.promise;}});await f.client.open();await f.client.start('192.168.20.10');f.setServer({...value(true),receipts:[row()]});await f.client.poll();const work=f.client.importing;await f.client.stop({leave:true});wait.resolve(new Response(new Blob(['WAVE'])));await work;assert.equal(f.imports.length,0);assert.equal(f.calls.filter(call=>call.path.endsWith('/ack')).length,0);assert.equal(f.client.state.active,false);f.client.clear();
});

test('a failed import requires manual retry, while a saved file is not reimported after acknowledgment failure',async()=>{
  let attempts=0,fail=true;const f=receiver({importFile:async()=>{++attempts;if(fail)throw new Error('quota');}});try{await f.client.open();await f.client.start('192.168.20.10');f.setServer({...value(true),receipts:[row()]});await f.client.poll();await f.client.importing;assert.equal(f.client.state.receipts[0].status,'failed');for(let i=0;i<100;i++)f.client.drain();assert.equal(attempts,1);fail=false;await f.client.retry(row().id);assert.equal(attempts,2);assert.equal(f.client.state.receipts[0].status,'imported');}finally{f.client.clear();}
  let imported=0;const g=receiver({importFile:async()=>++imported});await g.client.open();await g.client.start('192.168.20.10');g.setServer({...value(true),receipts:[row()]});const request=g.platform.request;let lost=true;g.platform.request=async(path,options)=>{if(path.endsWith('/ack') && options.body.ok && lost){lost=false;throw new Error('ack unavailable');}return request(path,options);};await g.client.poll();await g.client.importing;assert.equal(imported,1);assert.equal(g.client.state.receipts[0].status,'failed');await g.client.retry(row().id);assert.equal(imported,1);assert.equal(g.client.state.receipts[0].status,'imported');g.client.clear();
});

test('three unavailable heartbeats stop renewal and cancel in-flight work; confirmed stop is required before restart',async()=>{
  const f=receiver();try{await f.client.open();await f.client.start('192.168.20.10');f.platform.request=async()=>{throw new Error('offline')};for(let i=0;i<3;i++)await f.client.poll();assert.equal(f.client.state.active,false);assert.equal(f.client.state.needsStop,true);assert.equal(f.timers.size,0);assert.equal(await f.client.start('192.168.20.10'),false);assert.equal(await f.client.stop(),false);assert.match(f.client.state.warning,/not confirm|unconfirmed/i);}finally{f.client.clear();}
});

test('account changes, missing file bytes and hostile QR destinations fail before import',async()=>{
  const f=receiver();await f.client.open();await f.client.start('192.168.20.10');const ctx=f.client.context();++f.platform.generation;assert.equal(await f.client.accept(value(true),ctx),false);f.client.clear();
  const g=receiver({fetcher:async()=>new Response('short')});await g.client.open();await g.client.start('192.168.20.10');g.setServer({...value(true),receipts:[row()]});await g.client.poll();await g.client.importing;assert.equal(g.imports.length,0);assert.match(g.client.state.warning,/not fully received/i);g.client.clear();
  const h=receiver();await h.client.open();await assert.rejects(h.client.accept({...value(true),url:'https://evil.test/'},h.client.context()));assert.deepEqual(h.client.state.qrRows,[]);h.client.clear();
});

class FakeXhr {
  constructor(){this.upload={};this.status=200;this.responseText='已接收：海风.wav';this.readyState=0;}
  open(method,url){this.method=method;this.url=url;}setRequestHeader(name,value){this.header={name,value};}
  send(file){this.file=file;}abort(){this.onabort?.();}
  complete(answer){this.responseText=answer || this.responseText;this.onload();}
}
function sender(extra={}){const requests=[],uploader=new LanUploader({target:{origin:'http://192.168.20.10:1234',token:'b'.repeat(64)},xhr:()=>{const xhr=new FakeXhr();requests.push(xhr);return xhr;},delay:async()=>{},...extra});const file=new File(['WAVE'],'海风.wav');uploader.select([file]);return {uploader,requests,file};}

test('sender uses original File bytes and Android headers; 100 rapid clicks issue one raw upload',async()=>{
  const f=sender(),jobs=Array.from({length:100},()=>f.uploader.send());assert.equal(f.requests.length,1);const xhr=f.requests[0];assert.equal(xhr.file,f.file);assert.equal(xhr.method,'POST');assert.match(xhr.url,/\/upload\?name=/);assert.deepEqual(xhr.header,{name:'X-Tinglan-Key',value:'b'.repeat(64)});assert.equal(xhr.timeout,120000);xhr.complete();await Promise.all(jobs);assert.equal(f.uploader.state.completed,1);assert.equal(f.uploader.state.busy,false);
});

test('sender reports received/imported separately and only finishes after the receiver confirms the local commit',async()=>{
  const wait=deferred(),f=sender({fetcher:async(_url,options)=>{assert.equal(options.credentials,'omit');assert.equal(options.headers['X-Tinglan-Key'],'b'.repeat(64));return wait.promise;}}),work=f.uploader.send();f.requests[0].complete(JSON.stringify({receipt:'c'.repeat(48),status:'pending'}));await tick();assert.equal(f.uploader.state.completed,0);assert.equal(f.uploader.state.busy,true);wait.resolve(Response.json({status:'imported'}));assert.equal(await work,true);assert.equal(f.uploader.state.completed,1);
});

test('sender cancellation and early rejection cannot become success when old callbacks arrive',async()=>{
  const f=sender(),work=f.uploader.send();f.uploader.cancel();f.requests[0].complete();assert.equal(await work,false);assert.equal(f.uploader.state.completed,0);assert.equal(f.uploader.state.busy,false);
  const g=sender(),rejected=g.uploader.send(),xhr=g.requests[0];xhr.readyState=2;xhr.status=410;xhr.onreadystatechange();assert.equal(await rejected,false);assert.match(g.uploader.state.error,/Scan again/i);assert.equal(g.uploader.state.completed,0);
});

test('sender selection enforces audio names, count and byte limits before creating any request',()=>{
  const f=sender();assert.throws(()=>f.uploader.select([new File(['bad'],'script.html')]));assert.throws(()=>f.uploader.select([{name:'huge.wav',size:LAN_LIMITS.fileBytes+1}]));assert.throws(()=>f.uploader.select(Array(21).fill(f.file)));assert.throws(()=>f.uploader.select([{name:'a.wav',size:LAN_LIMITS.fileBytes},{name:'b.wav',size:LAN_LIMITS.fileBytes},{name:'c.wav',size:1}]));assert.equal(f.requests.length,0);
});

test('an HTTP 200 HTML page or malformed receipt cannot count as an imported song',async()=>{
  for(const reply of ['<html>not an upload confirmation</html>',JSON.stringify({receipt:'wrong',status:'imported'}),JSON.stringify({ok:true})]){const f=sender(),work=f.uploader.send();f.requests[0].complete(reply);assert.equal(await work,false);assert.equal(f.uploader.state.completed,0);assert.match(f.uploader.state.error,/did not confirm/i);}
  const f=sender(),work=f.uploader.send();f.requests[0].onprogress({loaded:8193});assert.equal(await work,false);assert.equal(f.uploader.state.completed,0);assert.match(f.uploader.state.error,/Unexpected/i);
});

test('a rejected new selection clears the old batch instead of silently sending previously selected files',async()=>{
  const f=sender();assert.throws(()=>f.uploader.select([new File(['bad'],'bad.exe')]));assert.deepEqual(f.uploader.state.files,[]);assert.equal(await f.uploader.send(),false);assert.equal(f.requests.length,0);
});

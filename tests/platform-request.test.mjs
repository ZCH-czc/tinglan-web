import test from 'node:test';
import assert from 'node:assert/strict';
import {requestPlatformJson,PLATFORM_JSON_LIMIT} from '../web/platform-request.mjs';
import {PlatformClient} from '../web/platform-client.mjs';
import {AccountStatusReader} from '../web/account-status.mjs';
const deferred=()=>{let resolve,reject;return {promise:new Promise((yes,no)=>{resolve=yes;reject=no;}),resolve:v=>resolve(v),reject:e=>reject(e)};};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const clock=()=>{let callback;const cleared=[];return {options:{setTimer:fn=>(callback=fn,17),clearTimer:handle=>cleared.push(handle)},fire:()=>callback(),cleared};};
test('a failed service read gives actionable copy without disclosing native error details or retrying',async()=>{
  let calls=0;await assert.rejects(requestPlatformJson('/api/accounts',{fetcher:()=>{++calls;throw new TypeError('Failed to fetch: private-address');}}),error=>error.code==='network' && /Local companion connection lost/i.test(error.message) && !/Failed|private/.test(error.message));assert.equal(calls,1);
});
test('uncertain mutation failures never suggest blindly resubmitting or automatically retry',async()=>{
  let calls=0;await assert.rejects(requestPlatformJson('/api/bili-action',{method:'POST',body:{liked:true},fetcher:async(_path,options)=>{++calls;assert.equal(options.credentials,'same-origin');assert.equal(options.headers['Content-Type'],'application/json');assert.equal(options.body,'{"liked":true}');throw new TypeError('connection closed');}}),error=>error.code==='network' && /action is unconfirmed/i.test(error.message) && /Refresh status/i.test(error.message));assert.equal(calls,1);
});
test('a pre-cancelled operation never starts, and a noncooperative late response is discarded',async()=>{
  const aborted=new AbortController();aborted.abort();await assert.rejects(requestPlatformJson('/api/catalog',{signal:aborted.signal,fetcher:()=>assert.fail('started after cancellation')}),{name:'AbortError'});
  const pending=deferred(),controller=new AbortController(),reason=new DOMException('left page','AbortError');let discarded=0;
  const result=requestPlatformJson('/api/catalog',{signal:controller.signal,fetcher:()=>pending.promise}).catch(e=>e);controller.abort(reason);assert.equal(await result,reason);
  pending.resolve(new Response(new ReadableStream({cancel(){++discarded;}})));await flush();assert.equal(discarded,1);
});
test('the response body shares the deadline and a stalled stream is cancelled',async()=>{
  const timer=clock();let cancelled=0,signal;
  const result=requestPlatformJson('/api/accounts',{...timer.options,fetcher:async(_path,options)=>{signal=options.signal;return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"accounts":'));},cancel(){++cancelled;}}));}}).catch(e=>e);
  await flush();timer.fire();const error=await result;assert.equal(error.name,'TimeoutError');assert.equal(error.code,'network');assert.match(error.message,/timed out|timeout/i);assert.equal(signal.aborted,true);await flush();assert.equal(cancelled,1);assert.deepEqual(timer.cleared,[17]);
});
test('cancelling while reading a JSON body preserves the original cancellation reason',async()=>{
  const controller=new AbortController(),reason=new DOMException('account replaced','AbortError');let cancelled=0;
  const result=requestPlatformJson('/api/accounts',{signal:controller.signal,fetcher:async()=>new Response(new ReadableStream({cancel(){++cancelled;}}))}).catch(e=>e);
  await flush();controller.abort(reason);assert.equal(await result,reason);assert.equal(cancelled,1);
});
test('successful UTF-8 chunks release their reader and clear the deadline',async()=>{
  const bytes=new TextEncoder().encode('{"name":"听岚"}'),timer=clock();const response=new Response(new ReadableStream({start(c){for(const b of bytes)c.enqueue(new Uint8Array([b]));c.close();}}));
  assert.deepEqual(await requestPlatformJson('/api/accounts',{...timer.options,fetcher:async()=>response}),{name:'听岚'});assert.equal(response.body.locked,false);assert.deepEqual(timer.cleared,[17]);
});
test('service JSON errors preserve account/rights/cooldown status and retry guidance',async()=>{
  for(const [status,code] of [[401,'sign-in'],[403,'rights'],[409,'session-changed'],[429,'verification']])await assert.rejects(requestPlatformJson('/api/catalog',{fetcher:async()=>new Response(JSON.stringify({error:{code,message:'平台明确提示'}}),{status,headers:{'retry-after':'31'}})}),{status,code,message:'平台明确提示',retryAfter:31});
});
test('invalid JSON, invalid UTF-8, primitive replies and oversized streams stop with protocol feedback',async()=>{
  for(const value of ['<html>private-error-content</html>','null','true',new Uint8Array([255])])await assert.rejects(requestPlatformJson('/api/accounts',{fetcher:async()=>new Response(value)}),error=>error.code==='invalid-response' && !/private/.test(error.message));
  let discarded=0;await assert.rejects(requestPlatformJson('/api/accounts',{fetcher:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(PLATFORM_JSON_LIMIT+1));},cancel(){++discarded;}}))}),{code:'invalid-response'});assert.equal(discarded,1);
});
test('deadline completion frees the account refresh owner and keeps the last known account metadata',async()=>{
  const client=new PlatformClient({}, {timeout:5,fetcher:async()=>new Promise(()=>{})});const reader=new AccountStatusReader(client);
  reader.accept({accounts:['qq','bili','netease'].map(source=>({source,connected:true,status:'verified',name:'fixture'}))});await reader.refresh();assert.equal(reader.state.loading,false);assert.equal(reader.pending,null);assert.equal(reader.state.value.accounts[1].status,'verified');assert.match(reader.state.error,/timed out|timeout/i);
});
test('service failures preserve accepted catalog cache without repeating the request',async()=>{
  let calls=0;const saved={songs:[{id:'saved'}]},client=new PlatformClient({read:async()=>saved},{fetcher:async()=>{++calls;throw new TypeError('Failed to fetch');}});
  assert.equal((await client.catalog('bili','fixture')).songs[0].id,'saved');assert.equal(calls,0);const value=await client.catalog('bili','fixture',1,{force:true});assert.equal(value.songs[0].id,'saved');assert.match(value.warning,/previous results/i);assert.equal(calls,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { PlatformClient } from '../web/platform-client.mjs';

const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const accounts=()=>json({revision:'a'.repeat(32),accounts:[]});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
test('a late IndexedDB read cannot cancel or overwrite a newer search',async()=>{
  const old=deferred(),current=deferred();const calls=[];
  const store={read:(_,key)=>key.includes('|old|')?old.promise:current.promise,cacheCatalog:async()=>{}};
  const client=new PlatformClient(store,{fetcher:async(url)=>{calls.push(url);return json({songs:[{id:'new'}]});}});
  const stale=client.catalog('qq','old').then(()=>assert.fail('obsolete result escaped'),e=>assert.equal(e.name,'AbortError'));
  const latest=client.catalog('qq','new');current.resolve(null);
  assert.deepEqual((await latest).songs,[{id:'new'}]);old.resolve(null);await stale;
  assert.equal(calls.length,1);assert.match(calls[0],/q=new/);assert.equal(client.controllers.size,0);
});
test('cancelled searches do not return an obsolete persistent cache entry',async()=>{
  const cached=deferred();let calls=0;
  const client=new PlatformClient({read:()=>cached.promise},{fetcher:async()=>{++calls;return json({});}});
  const pending=client.catalog('bili','first').catch(e=>e);client.cancel('search:bili');cached.resolve({songs:[{id:'stale'}]});
  assert.equal((await pending).name,'AbortError');assert.equal(calls,0);
});
test('cached pages avoid network requests, while a failed explicit refresh retains previous results',async()=>{
  let calls=0;const client=new PlatformClient({read:async()=>({songs:[{id:'saved'}]}),cacheCatalog:async()=>{}},{fetcher:async()=>{++calls;throw new Error('offline');}});
  assert.equal((await client.catalog('netease','music')).fromCache,true);assert.equal(calls,0);
  const fallback=await client.catalog('netease','music',1,{force:true});
  assert.equal(fallback.songs[0].id,'saved');assert.match(fallback.warning,/previous results/i);assert.equal(calls,1);
});
test('changing an account invalidates pending responses and removes catalog cache',async()=>{
  const result=deferred();let cleared=0;
  const client=new PlatformClient({read:async()=>null,cacheCatalog:async()=>assert.fail('old account cached'),clearCatalog:async()=>{++cleared;}},{fetcher:(url)=>url==='/api/account'?Promise.resolve(json({ok:true})):url==='/api/accounts'?Promise.resolve(accounts()):result.promise});
  const pending=client.catalog('qq','music').catch(e=>e);await Promise.resolve();await client.account('qq','own-test-session');result.resolve(json({songs:[]}));
  assert.equal((await pending).name,'AbortError');assert.equal(cleared,1);assert.equal(client.generation,1);
});
test('segmented context cache restores without fetching and rejects late data after cancellation or account change',async()=>{
  let called=0;const client=new PlatformClient({read:async()=>({bvid:'BV1xx411c7mD',parts:[]})},{fetcher:async()=>{++called;return json({});}});
  assert.equal((await client.biliContext('bili-BV1xx411c7mD')).bvid,'BV1xx411c7mD');assert.equal(called,0);
  const result=deferred(),abort=new AbortController();const pendingClient=new PlatformClient({read:()=>result.promise},{fetcher:async()=>assert.fail('cancelled cache reached network')});
  const pending=pendingClient.biliContext('bili-BV1xx411c7mD',{signal:abort.signal}).catch(e=>e);abort.abort();result.resolve({parts:[]});assert.equal((await pending).name,'AbortError');
  const network=deferred();const changing=new PlatformClient({read:async()=>null,cacheCatalog:async()=>assert.fail('old context saved'),clearCatalog:async()=>{}},{fetcher:url=>url==='/api/account'?Promise.resolve(json({ok:true})):url==='/api/accounts'?Promise.resolve(accounts()):network.promise});
  const stale=changing.biliContext('bili-BV1xx411c7mD').catch(e=>e);await flushMicrotasks();await changing.account('bili','');network.resolve(json({parts:[]}));assert.equal((await stale).name,'AbortError');
});
async function flushMicrotasks(){for(let i=0;i<4;i++)await Promise.resolve();}
test('persistent catalog namespace survives page reload only for the same server account revision',async()=>{
  const cache=new Map(),store={read:async(_name,key)=>cache.get(key),cacheCatalog:async(key,data)=>cache.set(key,data),clearCatalog:async()=>cache.clear()};let revision='a'.repeat(32),calls=0;
  const fetcher=async url=>url==='/api/accounts'?json({revision,accounts:[]}):(++calls,json({songs:[{id:revision[0]}]}));
  const first=new PlatformClient(store,{fetcher});await first.refreshAccounts();await first.catalog('qq','fixture');assert.equal(calls,1);
  const reload=new PlatformClient(store,{fetcher});await reload.refreshAccounts();assert.equal((await reload.catalog('qq','fixture')).songs[0].id,'a');assert.equal(calls,1);
  revision='b'.repeat(32);const newSession=new PlatformClient(store,{fetcher});await newSession.refreshAccounts();assert.equal((await newSession.catalog('qq','fixture')).songs[0].id,'b');assert.equal(calls,2);
  await first.refreshAccounts();assert.equal(first.generation,1);assert.equal(cache.size,0);
});
test('a delayed account read cannot overwrite a newer account snapshot',async()=>{
  const d=deferred();let reads=0;const client=new PlatformClient({},{fetcher:async()=>++reads===1?d.promise:json({revision:'b'.repeat(32),accounts:[]})});
  const old=client.refreshAccounts().catch(e=>e);await client.refreshAccounts();d.resolve(accounts());assert.equal((await old).name,'AbortError');assert.equal(client.accountRevision,'b'.repeat(32));
});
test('confirmed authorization immediately invalidates old work even when IndexedDB cleanup is unavailable',async()=>{
  const d=deferred();const client=new PlatformClient({read:async()=>null,clearCatalog:async()=>{throw new Error('database unavailable');},cacheCatalog:async()=>assert.fail('obsolete account cached')},{fetcher:()=>d.promise});client.accountRevision='a'.repeat(32);
  const old=client.catalog('bili','fixture').catch(e=>e);await flushMicrotasks();await client.invalidateAccount();assert.equal(client.generation,1);assert.equal(client.accountRevision,'');
  d.resolve(json({songs:[]}));assert.equal((await old).name,'AbortError');
});

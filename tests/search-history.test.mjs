import test from 'node:test';import assert from 'node:assert/strict';
import {searchTerm,searchHistory,rememberSearch,forgetSearch} from '../web/search-history.mjs';
import {normalizePreferences} from '../web/library-data.mjs';
import {PlatformClient} from '../web/platform-client.mjs';

test('search history keeps thirty most recent distinct bounded queries through restore',()=>{
  let rows=[];for(let i=0;i<45;i++)rows=rememberSearch(rows,` 曲目 ${i} `);
  rows=rememberSearch(rows,'曲目 20');assert.equal(rows.length,30);assert.equal(rows[0],'曲目 20');assert.equal(rows.at(-1),'曲目 15');
  assert.deepEqual(normalizePreferences({searchHistory:rows}).searchHistory,rows);
  assert.deepEqual(searchHistory([' A  B ','a b',null,'\n','　','C'] ),['A B','C']);
  assert.deepEqual(forgetSearch(['A','B'],' a '),['B']);assert.equal(searchTerm('x'.repeat(500)).length,200);
  assert.equal(searchTerm({q:'private'}),'');
});
test('blank searches, retries and pagination perform no network or cache reads for all platforms',async()=>{
  let reads=0,calls=0;const p=new PlatformClient({read:async()=>{reads++;},cacheCatalog:async()=>{}},{fetcher:async()=>{calls++;throw new Error('must not request');}});
  for(const source of ['qq','bili','netease'])for(const query of ['', '  ','\t\n','　'])for(const kind of ['songs','creators'])for(const page of [1,2]) {
    assert.deepEqual(await p.catalog(source,query,page,{scope:'search',force:true,kind}),{songs:[],creators:[],more:false});
  }
  assert.equal(calls,0);assert.equal(reads,0);
});
test('clearing a query cancels an older read before it can request or expose results',async()=>{
  let resolve,calls=0;const pending=new Promise(done=>resolve=done);
  const p=new PlatformClient({read:()=>pending},{fetcher:async()=>{calls++;}});
  const old=p.catalog('bili','泠鸢').catch(e=>e);await p.catalog('bili','　');resolve({songs:[{id:'obsolete'}]});
  assert.equal((await old).name,'AbortError');assert.equal(calls,0);
});
test('home recommendations remain available while search trims its transport query',async()=>{
  const urls=[];const p=new PlatformClient({read:async()=>null,cacheCatalog:async()=>{}},{fetcher:async url=>{urls.push(String(url));return new Response(JSON.stringify({songs:[],more:false}),{headers:{'content-type':'application/json'}});}});
  await p.catalog('qq','',1,{scope:'home'});await p.catalog('bili','  泠鸢　 y o u s a  ');
  assert.equal(urls.length,2);assert.equal(new URL(urls[1],'http://127.0.0.1').searchParams.get('q'),'泠鸢 y o u s a');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

async function fixture(extraAssets=[],origin='https://tinglan.test/') {
  const handlers=new Map(),cacheData=new Map(),fetched=[],network={offline:false};
  const key=value=>typeof value==='string'?value:value.url || value.href;
  const caches={open:async name=>{
    if(!cacheData.has(name))cacheData.set(name,new Map());const data=cacheData.get(name);
    return {put:async(url,response)=>data.set(key(url),response.clone()),match:async url=>data.get(key(url))?.clone()};
  },keys:async()=>[...cacheData.keys()],delete:async name=>cacheData.delete(name)};
  const self={location:{href:origin+'service-worker.mjs'},addEventListener:(name,fn)=>handlers.set(name,fn),clients:{claim:async()=>{}},skipWaiting:()=>{}};
  const fetch=async request=>{fetched.push(key(request));if(network.offline)throw new Error('offline');return new Response(key(request).endsWith('index.html')?'old document':'old module');};
  const source=(await readFile(new URL('../web/service-worker.mjs',import.meta.url),'utf8')).replace('__TINGLAN_BUILD_ID__','build-test').replace('__TINGLAN_ASSET_MANIFEST__',JSON.stringify(['index.html','ui.wasm','canvas-app.mjs',...extraAssets]));
  runInNewContext(source.replace(/^import[^\r\n]*\r?\n/gm,''),{self,caches,fetch,URL,Response,Promise,Set});
  async function lifecycle(name){let task;handlers.get(name)({waitUntil:value=>{task=value;}});await task;}
  async function request(path,{method='GET',mode='cors'}={}){let task;handlers.get('fetch')({request:{url:new URL(path,origin).href,method,mode},respondWith:value=>{task=value;}});return task;}
  return {lifecycle,request,network,fetched,cacheData};
}
test('offline documents and modules come from the same installed build without mixing a new document with old Wasm',async()=>{
  const f=await fixture();await f.lifecycle('install');const count=f.fetched.length;
  assert.equal(await (await f.request('/',{mode:'navigate'})).text(),'old document');assert.equal(f.fetched.length,count);
  f.network.offline=true;assert.equal(await (await f.request('/library',{mode:'navigate'})).text(),'old document');
  assert.equal(await (await f.request('/ui.wasm')).text(),'old module');
});
test('account APIs, media URLs, foreign origins and writes never enter the application asset cache',async()=>{
  const f=await fixture();await f.lifecycle('install');
  for(const [path,options] of [['/api/account',{}],['/api/media/opaque',{}],['https://other.test/ui.wasm',{}],['/canvas-app.mjs',{method:'POST'}]])assert.equal(await f.request(path,options),undefined);
  const keys=[...f.cacheData.values()][0].keys();assert.deepEqual([...keys].sort(),['https://tinglan.test/canvas-app.mjs','https://tinglan.test/index.html','https://tinglan.test/ui.wasm']);
});
test('activation removes obsolete application caches while preserving unrelated browser caches',async()=>{
  const f=await fixture();f.cacheData.set('tinglan-web-obsolete',new Map());f.cacheData.set('another-application',new Map());
  await f.lifecycle('install');await f.lifecycle('activate');assert.deepEqual([...f.cacheData.keys()].sort(),['another-application','tinglan-web-build-test']);
});
test('optional typefaces never delay installation and are cached only after explicit first use',async()=>{
  const path='composeResources/font/lxgw_wenkai_lite.ttf',f=await fixture([path]);await f.lifecycle('install');
  assert.equal(f.fetched.length,3);assert.ok(!f.fetched.some(url=>url.endsWith('.ttf')));
  await f.request('/'+path);assert.equal(f.fetched.length,4);f.network.offline=true;
  assert.equal(await (await f.request('/'+path)).text(),'old module');assert.equal(f.fetched.length,4);
});

test('Pages installations preserve other projects and serve offline assets within their own path',async()=>{
  const f=await fixture([],'https://tinglan.test/tinglan-web/');
  for(const name of ['tinglan-web-build-root','tinglan-pages:%2Fother%2F:old','tinglan-pages:%2Ftinglan-web%2F:old'])f.cacheData.set(name,new Map());
  await f.lifecycle('install');await f.lifecycle('activate');
  assert.deepEqual([...f.cacheData.keys()].sort(),['tinglan-pages:%2Fother%2F:old','tinglan-pages:%2Ftinglan-web%2F:build-test','tinglan-web-build-root']);
  f.network.offline=true;
  assert.equal(await (await f.request('/tinglan-web/',{mode:'navigate'})).text(),'old document');
  assert.equal(await (await f.request('/tinglan-web/ui.wasm')).text(),'old module');
  assert.equal(await f.request('/other/ui.wasm'),undefined);
});

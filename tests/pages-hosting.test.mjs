import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PlatformClient} from '../web/platform-client.mjs';
import {storageName, requireCompanion} from '../web/deployment.mjs';

test('static hosting rejects platform operations before credentials or requests leave the browser',async()=>{
  let requests=0;
  const client=new PlatformClient({},{staticHosting:true,fetcher:()=>{++requests;throw new Error('Unexpected network request');}});
  for(const action of [()=>client.request('/api/accounts'),()=>client.request('/api/account',{method:'POST',body:{source:'bili',cookie:'test-only'}}),()=>client.video('bili-test','80'),()=>client.request('/api/live-room?room=1')]){
    await assert.rejects(action,e=>e.code==='companion-required' && e.message.includes('GitHub Pages'));
  }
  assert.equal(requests,0);
});

test('blank static search remains local and never submits a discovery request',async()=>{
  let requests=0;
  const client=new PlatformClient({},{staticHosting:true,fetcher:()=>{++requests;}});
  assert.deepEqual(await client.catalog('bili','  ',1,{scope:'search'}),{songs:[],creators:[],more:false});
  assert.equal(requests,0);
});

test('local companion mode preserves its transport and original storage name',async()=>{
  let request;
  const client=new PlatformClient({},{staticHosting:false,fetcher:async(path)=>{request=path;return Response.json({ok:true});}});
  assert.deepEqual(await client.request('/api/health'),{ok:true});
  assert.equal(request,'/api/health');
  assert.equal(storageName('library',{staticHosting:false,scope:'%2Fone%2F'}),'library');
  assert.doesNotThrow(()=>requireCompanion(false));
});

test('independent static applications do not share an IndexedDB library',()=>{
  const first=storageName('library',{staticHosting:true,scope:'%2Fone%2F'});
  const second=storageName('library',{staticHosting:true,scope:'%2Ftwo%2F'});
  assert.equal(first,'library:%2Fone%2F');assert.notEqual(first,second);
});

test('Pages packaging sets static mode without changing local build or asset hashes',async()=>{
  const read=(path)=>readFile(new URL('../build/'+path,import.meta.url),'utf8');
  assert.match(await read('pages/deployment.mjs'),/DEPLOYMENT = 'static'/);
  assert.match(await read('dist/deployment.mjs'),/DEPLOYMENT = 'companion'/);
  const pages=JSON.parse(await read('pages/asset-manifest.json'));
  const local=JSON.parse(await read('dist/asset-manifest.json'));
  assert.notEqual(pages.build,local.build);
  assert.equal(pages.version,'0.31.2');
  assert.equal(pages.assets.find(x=>x.url==='ui/tinglan-web-ui.wasm').sha256,local.assets.find(x=>x.url==='ui/tinglan-web-ui.wasm').sha256);
  assert.ok(pages.assets.every(x=>!x.url.startsWith('server/') && !x.url.startsWith('shared/')));
});

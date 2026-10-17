import test from 'node:test';import assert from 'node:assert/strict';import {ImageGallery} from '../web/image-gallery.mjs';
const key=n=>'image-bili-'+String(n).padStart(40,'0');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('gallery opens only registered picture identities and preserves the tapped index',async()=>{
  const delivered=[],g=new ImageGallery({known:k=>[key(1),key(2)].includes(k),load:async k=>k,deliver:(...a)=>delivered.push(a)});
  assert.equal(g.open(['https://evil.test/a',key(9)]),false);
  assert.equal(g.open([key(1),key(2)],1),true);await flush();assert.equal(g.state.index,1);assert.equal(delivered[0][0],key(2)+':gallery');
  assert.equal(await g.select(-1),false);g.close();assert.equal(g.cache.size,0);assert.equal(g.state.open,false);
});
test('rapid image changes and closing reject late loads, even when a transport ignores abort',async()=>{
  const pending=new Map(),delivered=[],g=new ImageGallery({known:()=>true,load:k=>{const d=deferred();pending.set(k,d);return d.promise;},deliver:(...a)=>delivered.push(a)});
  g.open([key(1),key(2)]);const next=g.select(1);pending.get(key(2)).resolve('second');await next;pending.get(key(1)).resolve('first');await flush();assert.deepEqual(delivered,[[key(2)+':gallery','second']]);
  const retry=g.select(0);g.close();pending.get(key(1)).resolve('late');await retry;assert.equal(delivered.filter(([,d])=>d==='late').length,0);assert.equal(g.state.open,false);
});
test('image failures have a retry action and cache eviction releases old decoded images',async()=>{
  let calls=0,failed=true;const deliveries=[],g=new ImageGallery({known:()=>true,load:async k=>{calls++;if(failed)throw new Error('离线');return k;},deliver:(...a)=>deliveries.push(a)});
  g.open([1,2,3,4,5].map(key));await flush();assert.equal(g.state.status,'error');failed=false;await g.select(0,{retry:true});assert.equal(g.state.status,'ready');
  for(let i=1;i<5;i++)await g.select(i);assert.equal(g.cache.size,3);assert.ok(deliveries.some(([k,d])=>k===key(1)+':gallery' && d===''));
  const before=calls;await g.select(3);assert.equal(calls,before);g.close();assert.equal(g.cache.size,0);
});

test('rapid relative steps use controller state without waiting for a rendered frame',async()=>{
  const deliveries=[],g=new ImageGallery({known:()=>true,load:async k=>k,deliver:(...args)=>deliveries.push(args)});
  g.open([1,2,3,4,5].map(key),2);await flush();
  await Promise.all([g.step(1),g.step(1),g.step(-1)]);assert.equal(g.state.index,3);assert.equal(g.state.status,'ready');
  assert.equal(deliveries.at(-1)[0],key(4)+':gallery');g.close();
});

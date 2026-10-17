import test from 'node:test';
import assert from 'node:assert/strict';
import {QueueMetadataSaver} from '../web/queue-metadata.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('large queues and repeated replacements keep a global concurrency limit and discard obsolete pending work',async()=>{
  let active=0,maximum=0;const pending=new Map(),started=[],finished=[];
  const saver=new QueueMetadataSaver(id=>{++active;maximum=Math.max(maximum,active);started.push(id);return new Promise(resolve=>pending.set(id,()=>{--active;resolve();}));},errors=>finished.push(errors),{concurrency:4});
  saver.select(Array.from({length:2000},(_,i)=>'old-'+i));await flush();assert.equal(pending.size,4);
  for(let i=0;i<1000;i++)saver.select(['latest-'+i,'shared']);await flush();assert.equal(started.length,4);
  for(const id of [...pending.keys()]){pending.get(id)();pending.delete(id);}await flush();
  assert.deepEqual(started.slice(4),['latest-999','shared']);
  for(const resolve of pending.values())resolve();await flush();assert.equal(maximum,4);assert.deepEqual(finished,[[]]);
});
test('inflight duplicates are reused, current failures are reported once and obsolete errors do not taint a newer queue',async()=>{
  const pending=new Map(),started=[],finished=[];
  const saver=new QueueMetadataSaver(id=>{started.push(id);return new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));},errors=>finished.push(errors),{concurrency:2});
  saver.select(['old','shared']);await flush();saver.select(['shared','new','new']);pending.get('old').reject(new Error('obsolete'));await flush();
  pending.get('shared').reject(new Error('current'));pending.get('new').resolve();await flush();
  assert.deepEqual(started,['old','shared','new']);assert.deepEqual(finished,[['shared']]);
});
test('clear stops all pending metadata work and suppresses completion without breaking future saves',async()=>{
  let resolve;const started=[],finished=[];
  const saver=new QueueMetadataSaver(id=>{started.push(id);return id==='first'?new Promise(done=>resolve=done):Promise.resolve();},errors=>finished.push(errors),{concurrency:1});
  saver.select(['first','obsolete']);await flush();saver.clear();resolve();await flush();assert.deepEqual(started,['first']);assert.equal(finished.length,0);
  saver.select(['new']);await flush();assert.deepEqual(started,['first','new']);assert.deepEqual(finished,[[]]);
});

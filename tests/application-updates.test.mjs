import test from 'node:test';
import assert from 'node:assert/strict';
import { ApplicationUpdates } from '../web/application-updates.mjs';

function fixture() {
  const container=new EventTarget(),registration=new EventTarget(),changed=[];
  registration.waiting=null;registration.installing=null;let reloads=0;
  container.register=async()=>registration;
  const updates=new ApplicationUpdates(container,{changed:value=>changed.push(value),reload:()=>++reloads});
  return {container,registration,updates,changed,reloads:()=>reloads};
}
test('an installed application update remains waiting and never reloads playing sessions automatically',async()=>{
  const f=fixture(),worker=new EventTarget(),messages=[];worker.state='installing';worker.postMessage=value=>messages.push(value);
  await f.updates.start();f.registration.installing=worker;f.registration.dispatchEvent(new Event('updatefound'));
  worker.state='installed';f.registration.waiting=worker;worker.dispatchEvent(new Event('statechange'));
  assert.deepEqual(f.changed,[true]);assert.deepEqual(messages,[]);
  f.container.dispatchEvent(new Event('controllerchange'));assert.equal(f.reloads(),0);
  f.updates.activate();assert.deepEqual(messages,['activate-update']);
  f.container.dispatchEvent(new Event('controllerchange'));f.container.dispatchEvent(new Event('controllerchange'));assert.equal(f.reloads(),1);
});
test('existing waiting updates are exposed and missing or disabled workers remain usable',async()=>{
  const f=fixture();f.registration.waiting={postMessage:()=>{}};await f.updates.start();assert.deepEqual(f.changed,[true]);
  f.registration.waiting=null;assert.throws(()=>f.updates.activate(),/No installable update/i);
  await new ApplicationUpdates(undefined,{changed:()=>assert.fail(),reload:()=>assert.fail()}).start();
});
test('startup explicitly checks for a new build without activating it',async()=>{
  const f=fixture();let checks=0;
  f.registration.update=async()=>{checks++;f.registration.waiting={postMessage:()=>assert.fail('Update activated without a user action')};};
  await f.updates.start();assert.equal(checks,1);assert.deepEqual(f.changed,[true]);assert.equal(f.reloads(),0);
});
test('an offline update check preserves an already installed waiting version',async()=>{
  const f=fixture();f.registration.waiting={postMessage(){}};f.registration.update=async()=>{throw new TypeError('Offline');};
  await f.updates.start();assert.deepEqual(f.changed,[true]);assert.equal(f.updates.available,true);assert.equal(f.reloads(),0);
});


test('dismiss suppresses the same update but announces a later waiting worker',async()=>{
  const f=fixture(),first={postMessage(){}};f.registration.waiting=first;await f.updates.start();assert.equal(f.updates.prompt,true);
  f.updates.dismiss();f.updates.refresh();assert.equal(f.updates.available,true);assert.equal(f.updates.prompt,false);
  f.registration.waiting={postMessage(){}};f.updates.refresh();assert.equal(f.updates.prompt,true);assert.equal(f.reloads(),0);f.updates.dispose();
});

test('focus and online checks coalesce and use a five minute cooldown without reloading',async()=>{
  const f=fixture(),events=new EventTarget();let at=0,checks=0,finish;
  f.updates.events=events;f.updates.now=()=>at;f.registration.update=async()=>checks++;await f.updates.start();events.dispatchEvent(new Event('focus'));assert.equal(checks,1);
  at=300001;f.registration.update=()=>{checks++;return new Promise(r=>finish=r);};events.dispatchEvent(new Event('online'));events.dispatchEvent(new Event('focus'));assert.equal(checks,2);finish();await Promise.resolve();assert.equal(f.reloads(),0);f.updates.dispose();
});

test('a waiting worker can refuse activation while durable downloads are active',async()=>{
  const f=fixture(),worker={postMessage(){}};f.registration.waiting=worker;await f.updates.start();f.updates.activate();assert.equal(f.updates.requested,true);
  const message=new Event('message');message.data={type:'tinglan-update-blocked'};message.source=worker;f.container.dispatchEvent(message);assert.equal(f.updates.requested,false);f.container.dispatchEvent(new Event('controllerchange'));assert.equal(f.reloads(),0);assert.equal(f.updates.prompt,true);f.updates.dispose();
});

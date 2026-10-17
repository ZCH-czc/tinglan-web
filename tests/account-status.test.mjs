import test from 'node:test';import assert from 'node:assert/strict';
import {AccountStatusReader} from '../web/account-status.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};};
const metadata=(status='disconnected',name='')=>({accounts:['qq','bili','netease'].map(source=>({source,connected:status!=='disconnected',status,name,error:''}))});
test('a burst of status refreshes has one request and one shared completion',async()=>{
  const read=deferred();let calls=0;const reader=new AccountStatusReader({refreshAccounts:()=>{++calls;return read.promise;}});
  const tasks=Array.from({length:100},()=>reader.refresh());assert.ok(tasks.every(task=>task===tasks[0]));await Promise.resolve();assert.equal(calls,1);assert.equal(reader.state.loading,true);
  read.resolve(metadata());await Promise.all(tasks);assert.equal(reader.state.loaded,true);assert.equal(reader.state.loading,false);assert.equal(reader.state.value.accounts.length,3);
});
test('an unreadable service does not claim accounts are disconnected',async()=>{
  const reader=new AccountStatusReader({refreshAccounts:()=>{throw new Error('服务连接中断');}});await reader.refresh();
  assert.equal(reader.state.loaded,false);assert.equal(reader.state.loading,false);assert.equal(reader.state.error,'服务连接中断');assert.deepEqual(reader.state.value.accounts,[]);
});
test('a refresh failure retains the last known session and verification status',async()=>{
  const reader=new AccountStatusReader({refreshAccounts:async()=>{throw new Error('网络不可用');}});reader.accept(metadata('verified','账号昵称'));await reader.refresh();
  assert.equal(reader.state.loaded,true);assert.equal(reader.state.value.accounts[0].name,'账号昵称');assert.equal(reader.state.value.accounts[0].status,'verified');assert.ok(reader.state.error);
});
test('a delayed status read cannot replace a newly installed account even if it ignores abort',async()=>{
  const old=deferred();let signal;const reader=new AccountStatusReader({refreshAccounts:s=>{signal=s;return old.promise;}});
  const pending=reader.refresh();await Promise.resolve();reader.accept(metadata('unverified','新账号'));assert.equal(signal.aborted,true);
  old.resolve(metadata('verified','旧账号'));assert.equal(await pending,null);assert.equal(reader.state.value.accounts[0].name,'新账号');assert.equal(reader.state.loading,false);
});
test('an obsolete read cannot clear a newer loading indicator or publish its error',async()=>{
  const old=deferred(),recent=deferred();let calls=0;const reader=new AccountStatusReader({refreshAccounts:()=>++calls===1?old.promise:recent.promise});
  const first=reader.refresh();await Promise.resolve();reader.accept(metadata('unverified','新账号'));const second=reader.refresh();await Promise.resolve();old.reject(new Error('旧任务失败'));await first;
  assert.equal(reader.state.loading,true);assert.equal(reader.state.error,'');recent.resolve(metadata('verified','新账号'));await second;assert.equal(reader.state.loading,false);assert.equal(reader.state.value.accounts[0].status,'verified');
});
test('incomplete responses retain known accounts, and status metadata drops nonpublic fields',async()=>{
  const reader=new AccountStatusReader({refreshAccounts:async()=>({accounts:[]})});const value=metadata('expired','昵称');value.accounts[0].cookie='private-test-placeholder';reader.accept(value);await reader.refresh();
  assert.equal(reader.state.value.accounts[0].status,'expired');assert.match(reader.state.error,/Incomplete|incomplete/i);assert.equal('cookie' in reader.state.value.accounts[0],false);
});

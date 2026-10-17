import test from 'node:test';import assert from 'node:assert/strict';
import {VideoActions} from '../web/bilibili-actions.mjs';
import {PlatformClient} from '../web/platform-client.mjs';
import {bilibiliPartId} from '../web/bilibili-id.mjs';

const bvid='BV1xx411c7mD',id='bili-'+bvid,other='BV1yy411c7mD';
const result=(bvid,token='b',liked=false)=>({bvid,title:'现场',token:token.repeat(32),liked,folders:[{id:'10',title:'常听',selected:true},{id:'20',title:'现场',selected:false}]});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(overrides={}) {
  const reads=[],posts=[],states=[],platform={accountRevision:'a'.repeat(32),generation:0,videoActions:async(id,options)=>{reads.push({id,options});return result(id.slice(5).split('_')[0]);},videoAction:async(id,input)=>{posts.push({id,input});return result(bvid,'c',input.liked);},...overrides};
  let sequence=0;const controller=new VideoActions({platform,changed:value=>states.push(value),operationId:()=>String(++sequence).padStart(48,'0')});return {controller,platform,reads,posts,states};
}
test('opening cached video parts avoids refetching and retains checked folders',async()=>{
  const f=fixture();await f.controller.open(id);f.controller.choose('20');f.controller.close();await f.controller.open('bili-'+bilibiliPartId(bvid,'101'));
  assert.equal(f.reads.length,1);assert.equal(f.controller.state.folders[1].checked,true);assert.equal(f.controller.state.id,'bili-'+bilibiliPartId(bvid,'101'));
  await f.controller.open(id,{force:true});assert.equal(f.reads.length,2);assert.equal(f.controller.state.folders[1].checked,false);
});
test('100 rapid likes submit once without optimistic state, and completed acknowledgment updates the dialog',async()=>{
  const pending=deferred(),f=fixture();f.platform.videoAction=async(id,input)=>{f.posts.push({id,input});return pending.promise;};await f.controller.open(id);
  const attempts=Array.from({length:100},()=>f.controller.like());assert.equal(f.posts.length,1);assert.equal(f.controller.state.busy,true);assert.equal(f.controller.state.liked,false);
  pending.resolve(result(bvid,'c',true));assert.equal((await Promise.all(attempts)).filter(Boolean).length,1);assert.equal(f.controller.state.liked,true);assert.equal(f.controller.state.busy,false);
});
test('saving favorites sends only checked folder IDs, while an unchanged selection needs no network',async()=>{
  const f=fixture();await f.controller.open(id);await f.controller.favorites();assert.equal(f.posts.length,0);assert.match(f.controller.state.notice,/unchanged/i);
  f.controller.choose('10');f.controller.choose('20');f.platform.videoAction=async(id,input)=>{f.posts.push({id,input});const value=result(bvid,'c');value.folders=value.folders.map(row=>({...row,selected:input.selected.includes(row.id)}));return value;};
  await f.controller.favorites();assert.deepEqual(f.posts[0].input.selected,['20']);assert.equal(f.posts[0].input.action,'favorites');assert.equal(f.controller.state.folders[0].checked,false);assert.equal(f.controller.state.folders[1].selected,true);
});
test('liking a video preserves an unsaved folder selection, and checks cannot change during a POST',async()=>{
  const pending=deferred(),f=fixture();await f.controller.open(id);f.controller.choose('20');f.platform.videoAction=()=>pending.promise;
  const operation=f.controller.like();f.controller.choose('10');assert.equal(f.controller.state.folders[0].checked,true);pending.resolve(result(bvid,'c',true));await operation;assert.equal(f.controller.state.folders[1].checked,true);assert.equal(f.controller.state.folders[1].selected,false);
});
test('closing and reopening during a POST reattaches to that operation without repeating it',async()=>{
  const pending=deferred(),f=fixture();await f.controller.open(id);f.platform.videoAction=async(id,input)=>{f.posts.push({id,input});return pending.promise;};
  const operation=f.controller.like();f.controller.close();assert.equal(f.controller.active,null);await f.controller.open(id);assert.equal(f.controller.state.busy,true);assert.equal(f.reads.length,1);await f.controller.like();assert.equal(f.posts.length,1);
  pending.resolve(result(bvid,'c',true));await operation;assert.equal(f.controller.state.liked,true);
});
test('a late action acknowledgment cannot overwrite a different video or an account change',async()=>{
  const pending=deferred(),f=fixture();await f.controller.open(id);f.platform.videoAction=()=>pending.promise;const action=f.controller.like();await f.controller.open('bili-'+other);pending.resolve(result(bvid,'c',true));await action;
  assert.equal(f.controller.state.bvid,other);assert.equal(f.controller.state.liked,false);await f.controller.open(id);assert.equal(f.controller.state.liked,true);
  const second=deferred();f.platform.videoAction=()=>second.promise;const old=f.controller.like();++f.platform.generation;f.platform.accountRevision='d'.repeat(32);f.controller.clear();await f.controller.open('bili-'+other);second.resolve(result(bvid,'d',false));assert.equal(await old,false);assert.equal(f.controller.state.bvid,other);assert.equal(f.controller.cache.size,1);
});
test('late reads after 100 quick dialog changes cannot restore obsolete state or folders',async()=>{
  const pending=[],f=fixture({videoActions:(_id,options)=>{const request=deferred();pending.push({...request,options});return request.promise;}});
  const requests=Array.from({length:100},(_,i)=>f.controller.open(i%2?id:'bili-'+other));assert.equal(pending.length,100);assert.ok(pending.slice(0,-1).every(row=>row.options.signal.aborted));
  pending.at(-1).resolve(result(bvid,'c'));for(const request of pending.slice(0,-1))request.resolve(result(other,'b'));await Promise.all(requests);assert.equal(f.controller.state.bvid,bvid);assert.equal(f.controller.state.loaded,true);assert.equal(f.controller.state.warning,'');
});
test('unconfirmed network failures block more actions until the user refreshes',async()=>{
  const f=fixture();await f.controller.open(id);f.platform.videoAction=async(id,input)=>{f.posts.push({id,input});throw new Error('操作未确认成功');};await f.controller.like();assert.equal(f.controller.state.needsRefresh,true);assert.equal(f.controller.state.liked,false);
  for(let i=0;i<100;i++)await f.controller.like();assert.equal(f.posts.length,1);
  f.platform.videoActions=async()=>result(bvid,'d',true);await f.controller.open(id,{force:true});assert.equal(f.controller.state.needsRefresh,false);assert.equal(f.controller.state.liked,true);assert.equal(f.posts.length,1);
});
test('sign-in failures identify the account entry and malformed states never enable mutations',async()=>{
  const f=fixture({videoActions:async()=>{throw Object.assign(new Error('请登录'),{code:'sign-in'});}});await f.controller.open(id);assert.equal(f.controller.state.needsLogin,true);assert.equal(f.controller.state.loaded,false);await f.controller.like();assert.equal(f.posts.length,0);
  const g=fixture({videoActions:async()=>({...result(bvid),folders:[{id:'10',title:'x',selected:true},{id:'10',title:'duplicate',selected:false}]})});await g.controller.open(id);assert.match(g.controller.state.warning,/Invalid collection list/i);await g.controller.favorites();assert.equal(g.posts.length,0);
  await g.controller.open('qq-001AbCdefghij');assert.equal(g.controller.state.loaded,false);
});
test('account-owned dialog cache stays bounded and cached state expires',async()=>{
  let now=0;const f=fixture();f.controller.now=()=>now;
  for(let i=0;i<40;i++)await f.controller.open('bili-BV'+String(i).padStart(10,'0'));assert.ok(f.controller.cache.size<=12);
  await f.controller.open(id);const reads=f.reads.length;now=300001;await f.controller.open(id);assert.equal(f.reads.length,reads+1);
});
test('an expired open dialog requires a fresh read before sending a mutation',async()=>{
  let now=0;const f=fixture();f.controller.now=()=>now;await f.controller.open(id);now=300001;
  assert.equal(await f.controller.like(),false);assert.equal(f.posts.length,0);assert.equal(f.controller.state.needsRefresh,true);assert.match(f.controller.state.warning,/expired/i);
  await f.controller.open(id,{force:true});await f.controller.like();assert.equal(f.posts.length,1);
});
test('PlatformClient action routes skip IndexedDB, bind account revision and reject late account results',async()=>{
  const calls=[],pending=deferred(),client=new PlatformClient({read:()=>assert.fail('private state entered cache'),cacheCatalog:()=>assert.fail('private state persisted')},{fetcher:async(url,options)=>{calls.push({url,options});return url.startsWith('/api/bili-actions')?Response.json(result(bvid)):pending.promise;}});client.accountRevision='a'.repeat(32);
  await client.videoActions(id,{force:true});assert.match(calls[0].url,/revision=a{32}/);assert.match(calls[0].url,/force=1/);
  const operation=client.videoAction(id,{action:'like',liked:true,token:'b'.repeat(32),operation:'1'.repeat(48)}).catch(error=>error);await tick();assert.equal(calls[1].options.method,'POST');assert.equal(JSON.parse(calls[1].options.body).revision,'a'.repeat(32));++client.generation;client.accountRevision='c'.repeat(32);pending.resolve(Response.json(result(bvid,'c',true)));assert.equal((await operation).name,'AbortError');
});

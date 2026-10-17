import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {RequestGovernor} from '../server/upstream.mjs';
import {PlatformProviders} from '../server/providers.mjs';
import {BilibiliActions} from '../server/bilibili-actions.mjs';
import {createGateway} from '../server/gateway.mjs';
import {isolatedLoopback} from './helpers/http.mjs';
import {bilibiliPartId} from '../web/bilibili-id.mjs';

const bvid='BV1xx411c7mD',track={id:'bili-'+bvid,source:'bili',remoteId:bvid};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const operation=n=>n.toString(16).padStart(48,'0');
function fixture(extra={}) {
  const calls=[],session={id:'fixture-session',generation:0,accountRevision:'a'.repeat(32),cookies:{bili:'SESSDATA=fixture-owned; bili_jct='+ 'b'.repeat(32)}};
  const data={liked:false,folders:[{id:10,title:'<b>常听</b>',fav_state:1,attr:1},{id:20,title:'现场',fav_state:0,attr:0}],view:{bvid,aid:123,title:'<em>现场</em>',pages:[{cid:100},{cid:101}]},postCode:0};
  const fetcher=async(address,options)=>{
    const url=new URL(address),body=new URLSearchParams(options.body || '');calls.push({url,options,body});
    const override=await extra.fetcher?.(url,options,body);if(override)return override;
    let result;
    if(url.pathname==='/x/web-interface/view')result=data.view;
    else if(url.pathname==='/x/web-interface/nav')result={isLogin:true,mid:789};
    else if(url.pathname==='/x/web-interface/archive/has/like')result=data.liked?1:0;
    else if(url.pathname==='/x/v3/fav/folder/created/list-all')result={list:data.folders};
    else if(options.method==='POST') {
      if(data.postCode)return Response.json({code:data.postCode});
      if(url.pathname==='/x/web-interface/archive/like')data.liked=body.get('like')==='1';
      else if(url.pathname==='/x/v3/fav/resource/deal')data.folders=data.folders.map(row=>({...row,fav_state:body.get('add_media_ids').split(',').includes(String(row.id))?1:body.get('del_media_ids').split(',').includes(String(row.id))?0:row.fav_state}));
      else assert.fail('Unknown mutation path '+url.pathname);
      result=extra.postData || {};
    } else assert.fail('Unknown fixture path '+url.pathname);
    return Response.json({code:0,data:result});
  };
  const net=new RequestGovernor({fetcher,gap:0,now:extra.now || Date.now}),providers=new PlatformProviders(net),actions=new BilibiliActions({providers,now:extra.now || Date.now});
  const read=(subject=track,force=false)=>actions.state(session,subject,{revision:session.accountRevision,force});
  const input=(state,fields={},n=1)=>({revision:session.accountRevision,token:state.token,operation:operation(n),action:'like',liked:true,...fields});
  return {session,calls,data,net,providers,actions,read,input,posts:()=>calls.filter(row=>row.options.method==='POST')};
}

test('Bilibili interaction state verifies the video and account, bounds folder IDs, and never exposes credentials',async()=>{
  const f=fixture();f.data.view.description='unused metadata'.repeat(10000);const state=await f.read();assert.equal(state.bvid,bvid);assert.equal(state.title,'现场');assert.equal(state.liked,false);assert.deepEqual(state.folders,[{id:'10',title:'常听',selected:true,private:true},{id:'20',title:'现场',selected:false,private:false}]);
  assert.deepEqual([...f.actions.states.values()][0].view,{bvid,pages:[{cid:100},{cid:101}]});
  assert.match(state.token,/^[a-f0-9]{32}$/);assert.doesNotMatch(JSON.stringify(state),/SESSDATA|bili_jct|fixture-owned|csrf/);
  const folder=f.calls.find(row=>row.url.pathname.includes('created/list-all'));assert.equal(folder.url.searchParams.get('up_mid'),'789');assert.equal(folder.url.searchParams.get('rid'),'123');
  await f.read();assert.equal(f.calls.length,4);assert.equal(f.posts().length,0);
});
test('100 concurrent state reads coalesce and video parts share a single parent action state',async()=>{
  const f=fixture(),states=await Promise.all(Array.from({length:100},()=>f.read()));assert.equal(new Set(states.map(value=>value.token)).size,1);assert.equal(f.calls.length,4);
  const part={...track,remoteId:bilibiliPartId(bvid,'101')};assert.equal((await f.read(part)).token,states[0].token);assert.equal(f.calls.length,4);
  await assert.rejects(f.read({...track,remoteId:bilibiliPartId(bvid,'999')}),error=>error.code==='not-found');assert.equal(f.posts().length,0);
});
test('100 repeated operations share one POST, while different simultaneous intents cannot toggle twice',async()=>{
  const f=fixture(),state=await f.read(),input=f.input(state),results=await Promise.all(Array.from({length:100},()=>f.actions.mutate(f.session,track,input)));
  assert.equal(f.posts().length,1);assert.ok(results.every(value=>value.liked));assert.notEqual(results[0].token,state.token);
  const replay=await f.actions.mutate(f.session,track,input);assert.equal(replay.token,results[0].token);assert.equal(f.posts().length,1);
  await assert.rejects(f.actions.mutate(f.session,track,{...input,liked:false}),error=>error.code==='invalid-request');
  const current=results[0],changes=await Promise.allSettled(Array.from({length:100},(_,i)=>f.actions.mutate(f.session,track,f.input(current,{liked:false},i+2))));
  assert.equal(changes.filter(row=>row.status==='fulfilled').length,1);assert.equal(changes.filter(row=>row.status==='rejected'&&row.reason.code==='busy').length,99);assert.equal(f.posts().length,2);
  assert.equal(f.posts()[0].body.get('like'),'1');assert.equal(f.posts()[1].body.get('like'),'2');
});
test('favorites apply only the explicit added and removed account-owned folders',async()=>{
  const f=fixture(),state=await f.read(),value=await f.actions.mutate(f.session,track,f.input(state,{action:'favorites',selected:['20']}));
  assert.deepEqual(value.folders.map(row=>row.selected),[false,true]);assert.equal(f.posts().length,1);
  const post=f.posts()[0];assert.equal(post.url.pathname,'/x/v3/fav/resource/deal');assert.equal(post.body.get('rid'),'123');assert.equal(post.body.get('type'),'2');assert.equal(post.body.get('add_media_ids'),'20');assert.equal(post.body.get('del_media_ids'),'10');assert.equal(post.body.get('csrf'),'b'.repeat(32));
  await f.actions.mutate(f.session,track,f.input(value,{action:'favorites',selected:['20']},2));assert.equal(f.posts().length,1);
});
test('unknown folders, invalid booleans, forged tokens and unsupported actions cannot submit',async()=>{
  const f=fixture(),state=await f.read();
  for(const fields of [{action:'favorites',selected:['999']},{action:'favorites',selected:['10','10']},{action:'favorites',selected:[10]},{liked:1},{action:'coin'},{token:'0'.repeat(32)},{operation:'short'},{revision:'c'.repeat(32)}])await assert.rejects(f.actions.mutate(f.session,track,f.input(state,fields)));
  await assert.rejects(f.actions.mutate(f.session,{...track,source:'qq'},f.input(state)));assert.equal(f.posts().length,0);
});
test('unsafe integer video IDs and malformed folder lists stop before any mutation',async()=>{
  const f=fixture();f.data.view.aid=Number.MAX_SAFE_INTEGER+2;await assert.rejects(f.read(),error=>error.code==='invalid-response');assert.equal(f.posts().length,0);
  const malformed=fixture();malformed.data.folders=[{id:10,title:'a'},{id:10,title:'duplicate'}];await assert.rejects(malformed.read(),error=>error.code==='invalid-response');
  const huge=fixture();huge.data.folders=Array.from({length:501},(_,i)=>({id:i+1}));await assert.rejects(huge.read(),error=>error.code==='invalid-response');
});
test('network failures leave the action unconfirmed and block repeated POSTs until an explicit refresh',async()=>{
  let offline=true;const f=fixture({fetcher:async(_url,options)=>{if(options.method==='POST'&&offline)throw new Error('connection lost');}}),state=await f.read();
  await assert.rejects(f.actions.mutate(f.session,track,f.input(state)),error=>error.code==='network');assert.equal(f.posts().length,1);
  await assert.rejects(f.actions.mutate(f.session,track,f.input(state,{},2)),error=>error.code==='needs-refresh');assert.equal(f.posts().length,1);
  offline=false;const fresh=await f.read(track,true);assert.equal(fresh.liked,false);await f.actions.mutate(f.session,track,f.input(fresh,{},3));assert.equal(f.posts().length,2);
});
test('an applied action with a lost response is resolved by reading state and cannot be silently repeated',async()=>{
  let once=true,f;f=fixture({fetcher:async(_url,options)=>{if(options.method==='POST'&&once){once=false;f.data.liked=true;throw new Error('ack lost');}}});const state=await f.read();
  await assert.rejects(f.actions.mutate(f.session,track,f.input(state)));const fresh=await f.read(track,true);assert.equal(fresh.liked,true);assert.equal(f.posts().length,1);
  await f.actions.mutate(f.session,track,f.input(fresh,{},2));assert.equal(f.posts().length,1);
});
test('verification and partial favorites stop without retry or optimistic success',async()=>{
  const f=fixture(),state=await f.read();f.data.postCode=-352;
  await assert.rejects(f.actions.mutate(f.session,track,f.input(state)),error=>error.code==='verification');await assert.rejects(f.read(track,true),error=>error.code==='cooldown');assert.equal(f.posts().length,1);
  const partial=fixture({postData:{success_num:0}}),initial=await partial.read();
  await assert.rejects(partial.actions.mutate(partial.session,track,partial.input(initial,{action:'favorites',selected:['10','20']})),error=>error.code==='action-unconfirmed');assert.equal(partial.posts().length,1);
});
test('changing the account cancels queued POSTs and rejects late in-flight results',async()=>{
  const blocked=deferred(),entered=deferred();const f=fixture({fetcher:async(url)=>{if(url.pathname==='/block'){entered.resolve();return blocked.promise;}}}),state=await f.read();
  const blocker=f.net.json('bili','https://api.bilibili.com/block');await entered.promise;
  const mutation=f.actions.mutate(f.session,track,f.input(state)).catch(error=>error);await tick();f.actions.clearSession(f.session.id);++f.session.generation;f.session.accountRevision='c'.repeat(32);blocked.resolve(Response.json({code:0}));await blocker;
  assert.equal((await mutation).code,'session-changed');assert.equal(f.posts().length,0);
  const late=deferred(),postEntered=deferred(),g=fixture({fetcher:async(_url,options)=>{if(options.method==='POST'){postEntered.resolve();return late.promise;}}}),current=await g.read(),old=g.actions.mutate(g.session,track,g.input(current)).catch(error=>error);
  await postEntered.promise;g.actions.clearSession(g.session.id);++g.session.generation;late.resolve(Response.json({code:0}));assert.equal((await old).code,'session-changed');assert.equal(g.actions.states.size,0);
});
test('read state and operation journals remain bounded without losing pending action locks',async()=>{
  let now=1000;const f=fixture({now:()=>now});await f.read();now+=300001;f.actions.prune();assert.equal(f.actions.states.size,0);
  const current=await f.read();for(let i=1;i<=520;i++)await f.actions.mutate(f.session,track,f.input(await f.read(),{liked:false},i));assert.equal(f.actions.operations.size,512);assert.equal(f.posts().length,0);
  now+=600001;f.actions.prune();assert.equal(f.actions.operations.size,0);
  f.session.cookies.bili='';await assert.rejects(f.read(),error=>error.code==='sign-in');assert.equal(current.bvid,bvid);
});
test('real loopback action routes require own session, current revision and same origin, and keep responses private',async()=>{
  const f=fixture(),handler=createGateway({providers:f.providers}),server=createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  try {
    const first=await isolatedLoopback(base+'/api/accounts'),cookie=first.headers.get('set-cookie').split(';')[0];await first.json();
    const send=(path,value,headers={})=>isolatedLoopback(base+path,{method:value?'POST':'GET',headers:{Cookie:cookie,...(value?{'Content-Type':'application/json'}:{}),...headers},body:value?JSON.stringify(value):undefined});
    await (await send('/api/account',{source:'bili',cookie:f.session.cookies.bili})).json();const account=await (await send('/api/accounts')).json();
    const stateResponse=await send('/api/bili-actions?'+new URLSearchParams({id:track.id,revision:account.revision})),state=await stateResponse.json();assert.equal(stateResponse.status,200);assert.equal(stateResponse.headers.get('cache-control'),'no-store');assert.doesNotMatch(JSON.stringify(state),/fixture-owned|bili_jct/);
    const input={...f.input(state),id:track.id,revision:account.revision};
    assert.equal((await send('/api/bili-action',input,{Origin:'https://evil.test'})).status,403);
    assert.equal((await isolatedLoopback(base+'/api/bili-action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).status,409);
    assert.equal((await send('/api/bili-action')).status,405);assert.equal(f.posts().length,0);
    const success=await send('/api/bili-action',input);assert.equal(success.status,200);assert.equal((await success.json()).liked,true);assert.equal(f.posts().length,1);
    await (await send('/api/account',{source:'bili',cookie:''})).json();assert.equal((await send('/api/bili-action',input)).status,409);assert.equal(f.posts().length,1);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

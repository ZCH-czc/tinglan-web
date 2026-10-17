import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mapCreatorPresence,mapFollowedLive,presenceRequest,LivePresenceRepository} from '../server/bilibili-presence.mjs';
import {LivePresencePages,presenceRoute,validatePresence} from '../web/live-presence.mjs';
import {PlatformError,RequestGovernor} from '../server/upstream.mjs';
import {PlatformProviders} from '../server/providers.mjs';
import {PlatformClient} from '../web/platform-client.mjs';
import {createGateway} from '../server/gateway.mjs';
import {RouteHistory} from '../web/navigation.mjs';
import {SnapshotBridge} from '../web/snapshot-bridge.mjs';

const author={scope:'author',id:'123'},following={scope:'following',id:''};
const session=()=>({id:'test-session',generation:0,expiry:999999,cookies:{bili:'DedeUserID=123; SESSDATA=synthetic-fixture'}});
const live=()=>({live_users:{items:[{mid:123,room_id:321,uname:'UP 主',title:'正在演出',face:'https://i0.hdslb.com/a.jpg'}]}});
const status=(request=following,extra={})=>({...request,known:true,liveRoomId:'',items:[],fetchedAt:1000,...extra});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
async function serving(options,run) {
  const gateway=createGateway(options),server=createServer((req,res)=>gateway(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{return await run(`http://127.0.0.1:${server.address().port}`);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
async function json(url,options) {const response=await fetch(url,{...options,headers:{Connection:'close',...options?.headers}}),body=await response.json();return {response,body};}

test('live author mapping requires the exact owner, active status and lossless room identifiers',()=>{
  assert.deepEqual(mapCreatorPresence({mid:'123',live_room:{liveStatus:1,roomid:'123456789012345678'}},'123'),{known:true,liveRoomId:'123456789012345678',items:[]});
  assert.equal(mapCreatorPresence({mid:123,live_room:{liveStatus:0,roomid:321}},'123').liveRoomId,'');
  assert.equal(mapCreatorPresence({mid:123},'123').known,false);
  for(const data of [{mid:'999',live_room:{liveStatus:1,roomid:321}},{mid:123,live_room:{liveStatus:1,roomid:123456789012345678}},{mid:123,live_room:{liveStatus:1,roomid:'0'}},{mid:123,live_room:{liveStatus:'unknown'}}])assert.throws(()=>mapCreatorPresence(data,'123'),e=>e.code==='invalid-response');
  for(const request of [{scope:'foreign',id:'123'},{scope:'author',id:123},{scope:'author',id:'../../1'},{scope:'following',id:'another-person'}])assert.throws(()=>presenceRequest(request),e=>e.code==='invalid-request');
});

test('followed-live mapping sanitizes names and avatars, deduplicates authors and bounds the portal',()=>{
  const input=live();input.live_users.items.push({uid:'456',live_info:{room_id:'654'},name:'<b>歌手</b>',title:'<p>直播</p>',face:'https://attacker.test/avatar'},...input.live_users.items,{mid:123456789012345678,room_id:1,uname:'unsafe'},{mid:789,room_id:0,uname:'invalid'});
  const rows=mapFollowedLive(input).items;assert.equal(rows.length,2);assert.equal(rows[0].id,'123');assert.match(rows[0].avatar.key,/^image-bili-/);assert.ok(rows[0].avatar.path.startsWith('/api/public-image?'));assert.equal(rows[1].name,'歌手');assert.equal(rows[1].avatar,null);
  assert.equal(mapFollowedLive({live_users:{items:Array.from({length:1000},(_,i)=>({mid:String(i+1),roomid:String(i+1),uname:'UP'}))}}).items.length,50);
  assert.deepEqual(mapFollowedLive({live_users:{items:[]}}).items,[]);assert.throws(()=>mapFollowedLive({}),e=>e.code==='invalid-response');
});

test('following is own-account only and does not fall through to other endpoints on verification',async()=>{
  let calls=0;const p={bili:async()=>{++calls;throw new PlatformError('verification','需要验证',429);}},repo=new LivePresenceRepository({providers:p});
  for(const cookie of ['', 'SESSDATA=synthetic-fixture','DedeUserID=123; DedeUserID=456','DedeUserID=0'])await assert.rejects(repo.read({...session(),cookies:{bili:cookie}},following),e=>e.code==='sign-in');
  assert.equal(calls,0);await assert.rejects(repo.read(session(),following),e=>e.code==='verification');assert.equal(calls,1);assert.equal(repo.entries.size,0);
});

test('100 equivalent server reads coalesce; accepted status expires and explicit refresh is fresh',async()=>{
  const pending=deferred();let calls=0,now=1000;const seen=[];
  const repo=new LivePresenceRepository({now:()=>now,providers:{bili:async(...args)=>{seen.push(args);return ++calls===1?pending.promise:{data:live()};}}}),s=session();
  const jobs=Array.from({length:100},()=>repo.read(s,following));assert.equal(calls,1);pending.resolve({data:live()});const values=await Promise.all(jobs);assert.ok(values.every(row=>row===values[0]));assert.equal(values[0].items[0].roomId,'321');
  await repo.read(s,following);assert.equal(calls,1);await repo.read(s,following,{force:true});assert.equal(calls,2);assert.equal(seen.at(-1)[5].fresh,true);assert.equal(seen.at(-1)[0],'/x/polymer/web-dynamic/v1/portal');assert.equal(seen.at(-1)[1].up_list_more,1);
  now+=30001;await repo.read(s,following);assert.equal(calls,3);
});

test('author status uses the native signed owner endpoint and never requests uploads',async()=>{
  const calls=[],repo=new LivePresenceRepository({providers:{bili:async(...args)=>{calls.push(args);return {data:{mid:'123',live_room:{liveStatus:1,roomid:'321'}}};}}});
  const value=await repo.read(session(),author);assert.equal(value.liveRoomId,'321');assert.equal(calls.length,1);assert.equal(calls[0][0],'/x/space/wbi/acc/info');assert.equal(calls[0][3],true);assert.equal(calls[0][1].mid,'123');
});

test('account revocation aborts old presence requests and cannot cache a stale result',async()=>{
  const pending=deferred();let signal;const s=session(),repo=new LivePresenceRepository({providers:{bili:async(...args)=>{signal=args[5].signal;return pending.promise;}}});
  const job=repo.read(s,following);++s.generation;repo.clear(s.id);assert.equal(signal.aborted,true);pending.resolve({data:live()});await assert.rejects(job,e=>e.code==='session-changed');assert.equal(repo.entries.size,0);
});

test('server presence cache stays bounded without evicting an in-flight owner',async()=>{
  const pending=deferred(),repo=new LivePresenceRepository({limit:2,providers:{bili:async(_,q)=>q.mid==='1'?pending.promise:{data:{mid:q.mid,live_room:{liveStatus:0}}}}}),s=session();
  const first=repo.read(s,{scope:'author',id:'1'});await repo.read(s,{scope:'author',id:'2'});await repo.read(s,{scope:'author',id:'3'});assert.equal(repo.entries.size,2);assert.ok([...repo.entries.keys()].some(key=>key.endsWith('|1')));
  pending.resolve({data:{mid:'1',live_room:{liveStatus:0}}});await first;repo.clear(s.id);assert.equal(repo.entries.size,0);
});

test('manual no-store refresh replaces cached data and still observes platform verification cooldown',async()=>{
  let calls=0;const governor=new RequestGovernor({gap:0,fetcher:async()=>++calls<3?Response.json({code:0,value:calls}):new Response('',{status:412})});
  assert.equal((await governor.json('bili','https://api.bilibili.com/fixture')).value,1);assert.equal((await governor.json('bili','https://api.bilibili.com/fixture')).value,1);
  assert.equal((await governor.json('bili','https://api.bilibili.com/fixture',{cache:'no-store'})).value,2);assert.equal(governor.cache.size,0);
  await assert.rejects(governor.json('bili','https://api.bilibili.com/fixture',{cache:'no-store'}),e=>e.code==='verification');await assert.rejects(governor.json('bili','https://api.bilibili.com/fixture',{cache:'no-store'}),e=>e.code==='cooldown');assert.equal(calls,3);
});

test('provider fresh/abort options preserve canonical signing, cookie ownership and TTL',async()=>{
  const calls=[],provider=new PlatformProviders({json:async(...args)=>{calls.push(args);return {code:0,data:{mid:'123'}};}});provider.biliKey='a'.repeat(32);provider.biliExpiry=Date.now()+60000;const controller=new AbortController();
  await provider.bili('/x/space/wbi/acc/info',{mid:'123'},session(),true,false,{fresh:true,ttl:30000,signal:controller.signal});
  const [source,url,options,ttl,identity]=calls[0];assert.equal(source,'bili');assert.equal(new URL(url).origin,'https://api.bilibili.com');assert.ok(new URL(url).searchParams.has('w_rid'));assert.equal(options.signal,controller.signal);assert.equal(options.cache,'no-store');assert.equal(ttl,30000);assert.equal(identity,'test-session:0:0');assert.match(options.headers.Cookie,/synthetic-fixture/);
});

test('100 rapid client starts share one request and returning to cached tabs does not refresh',async()=>{
  const pending=deferred();let calls=0;const shown=[];const pages=new LivePresencePages(async request=>{++calls;return calls===1?pending.promise:status(request);},value=>shown.push(value));
  const jobs=Array.from({length:100},()=>pages.select(following));assert.equal(calls,1);pending.resolve(status());await Promise.all(jobs);const rows=pages.current.items;
  for(let i=0;i<100;i++)await pages.select(following);assert.equal(calls,1);assert.equal(pages.current.items,rows);assert.equal(shown.length,2);
  await pages.select(author);await pages.select(following);assert.equal(calls,2);await pages.select(following,{force:true});assert.equal(calls,3);
});

test('stale owner responses, hidden-page cancellation and malformed refresh cannot overwrite accepted presence',async()=>{
  const requests=[],pages=new LivePresencePages((request,options)=>{const d=deferred();requests.push({...d,request,signal:options.signal});return d.promise;},()=>{});
  const a=pages.select(author),b=pages.select(following);assert.equal(requests[0].signal.aborted,true);requests[1].resolve(status(following,{items:mapFollowedLive(live()).items}));await b;requests[0].resolve(status(author,{liveRoomId:'999'}));await a;assert.equal(pages.current.request.scope,'following');
  const refresh=pages.select(following,{force:true});requests[2].resolve(status(author));await refresh;assert.equal(pages.current.items[0].roomId,'321');assert.match(pages.current.warning,/mismatch|do not match|does not match/i);
  const hidden=pages.select(following,{force:true});pages.cancel();requests[3].resolve(status());await hidden;assert.equal(pages.current.items.length,1);await pages.select(following);assert.equal(pages.current.loading,false);assert.equal(requests.length,4);
  const late=pages.select(author);pages.clear();requests[4].resolve(status(author,{liveRoomId:'321'}));await late;assert.equal(pages.current,null);assert.equal(pages.cache.size,0);
});

test('presence route association and bounded caches never advertise another author room',async()=>{
  const pages=new LivePresencePages(async request=>status(request,{liveRoomId:request.scope==='author'?'321':''}),()=>{},{limit:2});
  await pages.select(author);assert.equal(pages.forRoute({page:'creator',creatorSource:'bili',creatorId:'123'}).liveRoomId,'321');assert.equal(pages.forRoute({page:'creator',creatorSource:'bili',creatorId:'456'}).liveRoomId,'');assert.equal(pages.forRoute({page:'search'}).items.length,0);
  for(const id of ['456','789'])await pages.select({scope:'author',id});assert.equal(pages.cache.size,2);assert.equal(presenceRoute({page:'creator',creatorSource:'qq',creatorId:'001Artist'}),null);
  assert.deepEqual(presenceRoute({page:'following',followingTab:'live'}),following);
  for(const value of [status(following,{liveRoomId:'321'}),status(author,{items:mapFollowedLive(live()).items}),status(following,{items:[...mapFollowedLive(live()).items,...mapFollowedLive(live()).items]})])assert.throws(()=>validatePresence(value,value.scope==='author'?author:following));
});

test('platform presence remains ephemeral and generation changes reject a late account reply',async()=>{
  const pending=deferred(),calls=[],client=new PlatformClient({read:()=>assert.fail('live status must not read persistent catalog'),cacheCatalog:()=>assert.fail('live status must not persist')},{fetcher:async url=>{calls.push(url);return pending.promise;}});
  const job=client.presence(following,{force:true});++client.generation;pending.resolve(Response.json(status()));await assert.rejects(job,e=>e.name==='AbortError');assert.match(calls[0],/refresh=1/);
});

test('live tab, author and live playback return to their exact origin routes',async()=>{
  const entries=[];let index=0,listener,shown;const host={location:{hash:'#following'},addEventListener:(_,value)=>listener=value};host.history={replaceState:state=>entries[index]=state,pushState:state=>{entries.splice(++index);entries[index]=state;},back:()=>{if(index>0){--index;queueMicrotask(()=>listener({state:entries[index]}));}}};
  const route=new RouteHistory(host,{page:'following',followingTab:'live'},value=>shown=value);route.update({page:'creator',creatorSource:'bili',creatorId:'123',creatorTab:'dynamics'});route.update({page:'live',liveRoomId:'321'});route.back();await Promise.resolve();assert.equal(shown.creatorTab,'dynamics');route.back();await Promise.resolve();assert.equal(shown.followingTab,'live');
});

test('50 live authors cross Wasm once in 1000 scalar updates and never enter retained page collections',()=>{
  const messages=[],bridge=new SnapshotBridge(raw=>messages.push(JSON.parse(raw))),liveCreators=Array.from({length:50},(_,i)=>({id:String(i+1),name:'UP',roomId:String(i+1)})),empty=[];
  for(let i=0;i<1000;i++)bridge.publish({viewKey:'following|live',liveCreators,presenceAnimating:i%2===0});assert.equal(messages[0].liveCreators.length,50);assert.ok(messages.slice(1).every(value=>!('liveCreators' in value)));assert.ok([...bridge.pages.values()].every(value=>!value.has('liveCreators')));
  bridge.publish({viewKey:'home',liveCreators:empty});assert.deepEqual(messages.at(-1).liveCreators,[]);
});

test('loopback gateway exposes own live status without cookies in the response and rejects foreign origins/methods',async()=>{
  const calls=[];await serving({providers:{bili:async(...args)=>{calls.push(args);return {data:args[0].endsWith('/portal')?live():{mid:'123',live_room:{liveStatus:1,roomid:'321'}}};}}},async base=>{
    const start=await json(base+'/api/health'),cookie=start.response.headers.get('set-cookie').split(';')[0],headers={Cookie:cookie};
    assert.equal((await json(base+'/api/bili-presence?scope=following&id=',{headers})).response.status,401);assert.equal(calls.length,0);
    await json(base+'/api/account',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({source:'bili',cookie:'DedeUserID=123; SESSDATA=synthetic-fixture'})});
    const value=await json(base+'/api/bili-presence?scope=following&id=',{headers});assert.equal(value.body.items[0].roomId,'321');assert.equal(value.response.headers.get('cache-control'),'no-store');assert.ok(!JSON.stringify(value.body).includes('synthetic-fixture'));
    assert.equal((await json(base+'/api/bili-presence?scope=following&id=',{headers:{Cookie:cookie,'Sec-Fetch-Site':'cross-site'}})).response.status,403);
    assert.equal((await json(base+'/api/bili-presence?scope=following&id=',{method:'POST',headers})).response.status,405);
    assert.equal((await json(base+'/api/bili-presence?scope=following&id=')).response.status,401);
    assert.equal((await json(base+'/api/bili-presence?scope=author&id=123',{headers})).body.liveRoomId,'321');assert.equal(calls.length,2);
  });
});

test('an account change during a real loopback presence request returns session-changed before exposing authors',async()=>{
  const pending=deferred(),entered=deferred();await serving({providers:{bili:async()=>{entered.resolve();return pending.promise;}}},async base=>{
    const start=await json(base+'/api/health'),headers={Cookie:start.response.headers.get('set-cookie').split(';')[0]};const job=json(base+'/api/bili-presence?scope=author&id=123',{headers});await entered.promise;
    await json(base+'/api/account',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({source:'bili',cookie:''})});pending.resolve({data:{mid:'123',live_room:{liveStatus:1,roomid:'321'}}});const value=await job;assert.equal(value.response.status,409);assert.equal(value.body.error.code,'session-changed');assert.equal(value.body.items,undefined);
  });
});

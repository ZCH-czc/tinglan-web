import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {mapActivity,activityPage,activityFeed,activityDetail,activitySongs,followedCreators} from '../server/bilibili-activities.mjs';
import {createGateway} from '../server/gateway.mjs';
import {PlatformError} from '../server/upstream.mjs';
import {ActivityFeed} from '../web/activity-feed.mjs';
import {PlatformClient} from '../web/platform-client.mjs';
import {CreatorPages} from '../web/creator-pages.mjs';
import {isolatedLoopback} from './helpers/http.mjs';
const fetch=isolatedLoopback,statusResponse=isolatedLoopback;

const ID='1234567890123456789',bvid='BV1xx411c7mD',request={scope:'author',id:'123'};
function dynamic(id=ID,patch={}) {return {id_str:id,type:'DYNAMIC_TYPE_AV',basic:{comment_id_str:'987654321012345678',comment_type:17},modules:{module_author:{mid:'123',name:'UP 主',face:'https://i0.hdslb.com/avatar.jpg',pub_ts:1700000000},module_dynamic:{desc:{text:'风从海上来[笑]',rich_text_nodes:[{orig_text:'[笑]',emoji:{icon_url:'https://i0.hdslb.com/emote.png'}}]},major:{archive:{bvid,title:'海风',cover:'https://i0.hdslb.com/cover.jpg',duration_text:'03:15'}}},module_stat:{comment:{count:2},like:{count:10},forward:{count:1}},module_tag:{text:'置顶'}},...patch};}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function serving(options,run) {const gateway=createGateway(options),server=createServer((req,res)=>gateway(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));try{await run(`http://127.0.0.1:${server.address().port}`)}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}}

test('dynamic IDs and platform comment targets remain separate lossless strings',()=>{
  const row=mapActivity(dynamic());assert.equal(row.id,ID);assert.equal(row.commentTarget.oid,'987654321012345678');assert.equal(row.commentTarget.type,17);assert.equal(row.pinned,true);assert.equal(row.song.id,'bili-'+bvid);assert.equal(row.song.durationMs,195000);assert.equal(row.song.creatorId,'123');assert.match(row.avatar.path,/public-image/);assert.equal(row.emotes.length,1);
  for(const id of [1234567890123456789,'0','1'.repeat(25),'../../1'])assert.equal(mapActivity(dynamic(id)),null);
  const target=dynamic();target.basic={comment_id_str:1234567890123456789,comment_type:99};assert.equal(mapActivity(target).commentTarget,null);
});
test('forwarded dynamics preserve one original level, deleted originals and pinned metadata',()=>{
  const original=dynamic('123'),row=mapActivity(dynamic(ID,{type:'DYNAMIC_TYPE_FORWARD',orig:{...original,orig:dynamic('124')}}));assert.equal(row.type,'forward');assert.equal(row.original.id,'123');assert.equal(row.original.original,null);assert.deepEqual(activitySongs([row]).map(s=>s.id),['bili-'+bvid]);
  assert.equal(mapActivity(dynamic(ID,{type:'DYNAMIC_TYPE_FORWARD',orig:{type:'DYNAMIC_TYPE_NONE',id_str:'123'}})).originalUnavailable,true);
  assert.equal(mapActivity(dynamic(ID,{type:'DYNAMIC_TYPE_AD'})),null);
});
test('opus text and image grids are bounded and hostile image destinations never become proxy references',()=>{
  const raw=dynamic();raw.modules.module_dynamic={major:{opus:{title:'<b>图文</b>',summary:{rich_text_nodes:[{text:'纯文字'},...Array.from({length:400},()=>({text:'很长'}))]},pics:[{url:'https://attacker.test/a.jpg'},...Array.from({length:14},(_,i)=>({url:`https://i0.hdslb.com/${i}.jpg`}))]}}};
  const row=mapActivity(raw);assert.equal(row.title,'图文');assert.equal(row.type,'pictures');assert.ok(row.pictures.length<=9);assert.ok(row.text.length<=10000);assert.equal(row.pictures.some(p=>p.path.includes('attacker')),false);
  raw.modules.module_dynamic={major:{archive:{bvid,title:'',duration_text:'02:99'}}};assert.equal(mapActivity(raw),null);
});
test('dynamic feed cursors require a genuine next offset and login-gated feeds never call upstream as guests',async()=>{
  assert.equal(activityPage({items:[dynamic(),dynamic()],offset:'same',has_more:1},'same').next,'');assert.equal(activityPage({items:[dynamic()],offset:'next',has_more:true}).next,'next');assert.equal(activityPage({items:[],offset:'x'.repeat(513),has_more:true}).next,'');
  let calls=0;const p={bili:async(path,q)=>{++calls;assert.equal(path,'/x/polymer/web-dynamic/v1/feed/space');assert.equal(q.host_mid,'123');return {data:{items:[dynamic()],has_more:false}};}};
  await assert.rejects(activityFeed(p,{scope:'following'}),e=>e.code==='sign-in');assert.equal(calls,0);await activityFeed(p,request);assert.equal(calls,1);
  await assert.rejects(activityFeed(p,{scope:'author',id:'../123'}),e=>e.code==='invalid-request');await assert.rejects(activityFeed(p,{...request,cursor:'x\n'}),e=>e.code==='invalid-request');
});
test('dynamic detail verifies its identity and cannot fall back from verification to another endpoint',async()=>{
  await assert.rejects(activityDetail({bili:async()=>({data:{item:dynamic('999')}})},ID),e=>e.code==='not-found');
  let calls=0;await assert.rejects(activityDetail({bili:async()=>{++calls;throw new PlatformError('verification','验证',429);}},ID),e=>e.code==='verification');assert.equal(calls,1);
});
test('followed author pages resolve the signed-in user and advance by raw platform page size',async()=>{
  let query;const p={bili:async(path,q)=>{query=q;assert.equal(path,'/x/relation/followings');return {data:{total:51,list:Array.from({length:50},(_,i)=>({mid:String(i+1),uname:'作者',face:'https://i0.hdslb.com/face.jpg'}))}};}};
  await assert.rejects(followedCreators(p,1,{cookies:{bili:'SESSDATA=own'}}),e=>e.code==='sign-in');assert.equal(query,undefined);
  const value=await followedCreators(p,1,{cookies:{bili:'DedeUserID=123; SESSDATA=own'}});assert.equal(query.vmid,'123');assert.equal(value.next,'2');assert.equal(value.items.length,50);assert.ok(value.items[0].image);
  await assert.rejects(followedCreators(p,501,{cookies:{bili:'DedeUserID=123'}}),e=>e.code==='invalid-request');
});
test('followed authors retain the platform count while bounded pages are appended and restored',async()=>{
  let shown;const feed=new ActivityFeed(async r=>({items:[{id:r.cursor || '1'}],total:57,next:r.cursor?'':'2'}),s=>shown=s);
  await feed.select({scope:'followings'});assert.equal(shown.total,57);await feed.more();assert.equal(shown.total,57);assert.equal(shown.items.length,2);await feed.select({scope:'followings'});assert.equal(shown.total,57);
});
test('gateway dynamically resolves comment oid and type, preserves floors and never makes dynamics playable tracks',async()=>{
  const calls=[],p={bili:async(path,q)=>{calls.push({path,q});if(path.endsWith('/detail'))return {data:{item:dynamic()}};if(path==='/x/v2/reply')return {data:{page:{count:2},replies:[{rpid_str:'456',member:{mid:'123',uname:'UP'},content:{message:'评论'},replies:[{rpid_str:'789',member:{uname:'听众'},content:{message:'回复'}}],rcount:1}]}};if(path==='/x/v2/reply/reply')return {data:{page:{count:1,size:20},replies:[{rpid_str:'789',content:{message:'回复'},member:{uname:'听众'}}]}};assert.fail(path);}};
  await serving({providers:p},async base=>{
    let response=await fetch(base+'/api/bili-dynamic?id='+ID);assert.equal(response.status,200);assert.equal((await response.json()).activity.id,ID);
    response=await fetch(base+'/api/comments?id=bili-dynamic-'+ID);const value=await response.json();assert.equal(value.items[0].badges[0],'Creator');assert.equal(value.subject.id,'bili-dynamic-'+ID);assert.equal(calls.at(-1).q.oid,'987654321012345678');assert.equal(calls.at(-1).q.type,17);
    response=await fetch(base+'/api/comments?id=bili-dynamic-'+ID+'&root=456');assert.equal((await response.json()).items[0].text,'回复');assert.equal(calls.at(-1).q.root,'456');
    assert.equal((await statusResponse(base+'/api/stream?id=bili-dynamic-'+ID)).status,400);
  });
});
test('profile-only author navigation never requests uploads and account changes discard pending dynamics',async()=>{
  const pending=deferred(),entered=deferred();let profileOnly=false;
  await serving({providers:{bili:async(path)=>{if(path==='/x/web-interface/card'){profileOnly=true;return {data:{card:{mid:'123',name:'UP'}}};}if(path.endsWith('/detail')){entered.resolve();return pending.promise;}assert.fail('unexpected upload request');}}},async base=>{
    const health=await fetch(base+'/api/health'),cookie=health.headers.get('set-cookie').split(';')[0];await health.json();
    const profile=await fetch(base+'/api/creator?source=bili&id=123&mode=profile',{headers:{Cookie:cookie}});assert.equal((await profile.json()).songs.length,0);assert.equal(profileOnly,true);
    const late=fetch(base+'/api/bili-dynamic?id='+ID,{headers:{Cookie:cookie}});await entered.promise;
    await statusResponse(base+'/api/account',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({source:'bili',cookie:'DedeUserID=123'})});pending.resolve({data:{item:dynamic()}});const value=await late;assert.equal(value.status,409);assert.equal((await value.json()).error.code,'session-changed');
  });
});
test('feed caches immutable merged pages, stops duplicate and cyclic cursors and keeps scroll content on return',async()=>{
  let calls=0,shown;const pages=new ActivityFeed(async r=>{++calls;return r.cursor?{items:[{id:'b'},{id:'a',text:'更新'}],next:'x'}:{items:[{id:'a'}],next:'x'};},s=>shown=s);
  await pages.select(request);const first=shown.items;await pages.more();assert.notEqual(shown.items,first);assert.equal(first.length,1);assert.equal(shown.items[0].text,'更新');assert.equal(shown.next,'');assert.match(shown.notice,/repeated|duplicate/i);await pages.select(request);assert.equal(calls,2);assert.equal(shown.items.length,2);
  const duplicate=new ActivityFeed(async()=>({items:[{id:'a'}],next:String(++calls)}),s=>shown=s);await duplicate.select(request);await duplicate.more();assert.equal(shown.next,'');assert.match(shown.notice,/repeated|duplicate/i);
});
test('late feed responses and duplicate more clicks never overwrite another author; cache and feed size stay bounded',async()=>{
  const requests=[],states=[];const pages=new ActivityFeed((r,options)=>{const d=deferred();requests.push({...d,r,signal:options.signal});return d.promise;},s=>states.push(s),{limit:2,maxItems:2});
  const a=pages.select(request),b=pages.select({...request,id:'456'});assert.equal(requests[0].signal.aborted,true);requests[1].resolve({items:[{id:'b',song:{id:'bili-b'}}],next:'x'});await b;requests[0].resolve({items:[{id:'late'}],next:'y'});await a;assert.equal(pages.current.items[0].id,'b');
  const more=pages.more();await pages.more();assert.equal(requests.length,3);requests[2].resolve({items:[{id:'c'},{id:'d'}],next:'z'});await more;assert.equal(pages.current.items.length,2);assert.equal(pages.current.next,'');assert.match(pages.current.notice,/latest 2 items/i);
  for(const id of ['789','999']){const select=pages.select({...request,id});requests.at(-1).resolve({items:[],next:''});await select;}assert.equal(pages.cache.size,2);assert.equal(pages.retainedSongs().length,0);pages.clear();assert.equal(pages.current,null);
});
test('a failed manual feed refresh preserves accepted content and pagination for a later explicit retry',async()=>{
  let fail=false,shown;const pages=new ActivityFeed(async()=>{if(fail)throw new Error('offline');return {items:[{id:'old'}],next:'next'}},s=>shown=s);await pages.select(request);fail=true;await pages.select(request,{force:true});assert.equal(shown.items[0].id,'old');assert.equal(shown.next,'next');assert.equal(shown.warning,'offline');assert.equal(shown.loading,false);
});
test('client and retained author caches keep profile requests separate and session changes invalidate dynamic data',async()=>{
  const calls=[],cache=new Map(),client=new PlatformClient({read:async(_,key)=>cache.get(key),cacheCatalog:async(key,value)=>cache.set(key,value),clearCatalog:async()=>cache.clear()},{fetcher:async url=>{calls.push(url);return Response.json(url==='/api/accounts'?{revision:'a'.repeat(32),accounts:[]}:{profile:{name:'UP'},songs:[],activity:mapActivity(dynamic())});}});
  await client.creator('bili','123',1,{profileOnly:true});await client.creator('bili','123',1);assert.equal(calls.length,2);assert.match(calls[0],/mode=profile/);
  await client.activityDetail({id:ID});await client.activityDetail({id:ID});assert.equal(calls.length,3);await client.account('bili','');await client.activityDetail({id:ID});assert.equal(calls.length,6);
  const modes=[],pages=new CreatorPages(async(s,id,page,options)=>{modes.push(options.profileOnly);return {profile:{name:'UP'},songs:[]}},()=>{});await pages.select('bili','123',1,{profileOnly:true});await pages.select('bili','123',1);assert.deepEqual(modes,[true,false]);
});

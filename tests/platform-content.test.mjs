import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {searchCreators} from '../server/creators.mjs';
import {comments,mapComment,commentCursor} from '../server/comments.mjs';
import {collection} from '../server/collections.mjs';
import {createGateway} from '../server/gateway.mjs';
import {isolatedLoopback} from './helpers/http.mjs';
import {publicImage} from '../server/content-images.mjs';
import {PlatformError} from '../server/upstream.mjs';
const biliTrack={source:'bili',remoteId:'BV1xx411c7mD'},qqTrack={source:'qq',remoteId:'001AbCdefghij',songId:123},netTrack={source:'netease',remoteId:'456'};
const biliRow=(id='1')=>({rpid_str:id,content:{message:'海风 [微笑]',emote:{'[微笑]':{url:'https://i0.hdslb.com/emote.png'}}},member:{mid:'123',uname:'UP 主',avatar:'https://i0.hdslb.com/face.jpg',level_info:{current_level:6}},ctime:1700000000,rcount:2,like:8});

test('Bilibili floor replies return the exact canonical parent, emotes and avatar without duplicating it',async()=>{
  const parent='987654321012345678',reply='987654321012345679',p={bili:async path=>path==='/x/web-interface/view'?{data:{aid:123,owner:{mid:123}}}:{data:{root:biliRow(parent),replies:[biliRow(parent),biliRow(reply)],page:{count:1,size:20}}}};
  const value=await comments(p,biliTrack,{root:parent});assert.equal(value.parent.id,parent);assert.equal(value.parent.authorId,'123');assert.ok(value.parent.avatar);assert.equal(value.parent.emotes.length,1);assert.deepEqual(value.items.map(row=>row.id),[reply]);assert.equal(value.next,'');
});
test('a mismatched returned Bilibili parent cannot display another thread as the requested one',async()=>{
  const p={bili:async path=>path==='/x/web-interface/view'?{data:{aid:123}}:{data:{root:biliRow('999'),replies:[],page:{count:0}}}};
  await assert.rejects(comments(p,biliTrack,{root:'123'}),error=>error.code==='invalid-response');
});

test('author search uses canonical platform protocols, sanitises names and preserves IDs and avatars',async()=>{
  const calls=[],p={bili:async(path,q,session,signed)=>{calls.push({path,q,signed});return {data:{result:[{mid:123,uname:'<b>作者</b>',upic:'https://i0.hdslb.com/face.jpg',fans:8}],numResults:40,numPages:2}};},qq:async(module,method,q)=>{calls.push({module,method,q});return {body:{singer:{items:[{singer_mid:'001Artist',singer_name:'歌手'}]}},meta:{sum:40,nextpage:2}};},netease:async(path,q)=>{calls.push({path,q});return {result:{artists:[{id:789,name:'音乐人',picUrl:'https://p1.music.126.net/face.jpg'}],artistCount:40}};}};
  const bili=await searchCreators(p,'bili','海风',1);assert.equal(bili.creators[0].name,'作者');assert.equal(bili.creators[0].id,'123');assert.equal(bili.more,true);assert.equal(calls[0].q.search_type,'bili_user');assert.equal(calls[0].signed,true);
  assert.equal((await searchCreators(p,'qq','海风',1)).creators[0].id,'001Artist');assert.equal(calls[1].q.search_type,1);assert.equal(calls[1].q.num_per_page,20);
  assert.equal((await searchCreators(p,'netease','海风',2)).creators[0].id,'789');assert.equal(calls[2].q.type,100);assert.equal(calls[2].q.offset,20);
  await assert.rejects(searchCreators(p,'bili','x',101),e=>e.code==='invalid-request');
});
test('QQ author suggestions are explicit and verification or account failures never trigger fallback',async()=>{
  let fallback=0;const p={qq:async()=>{throw new PlatformError('unavailable','unsupported');},headers:()=>({}),net:{json:async()=>{++fallback;return {code:0,data:{singer:{itemlist:[{mid:'001Artist',name:'歌手'}]}}};}}};
  assert.match((await searchCreators(p,'qq','海风',1)).warning,/suggestions/i);assert.equal(fallback,1);
  p.qq=async()=>({body:{singer:[]},meta:{sum:0}});assert.equal((await searchCreators(p,'qq','海风',1)).creators.length,1);assert.equal(fallback,2);
  for(const code of ['verification','sign-in','cooldown']){p.qq=async()=>{throw new PlatformError(code,'blocked');};await assert.rejects(searchCreators(p,'qq','海风',1),e=>e.code===code);}assert.equal(fallback,2);
});
test('comment mappings preserve Unicode, long text, badges, quotes, images and bounded reply previews',()=>{
  const row=biliRow();row.content.message='<p>'+('音乐🎵'.repeat(1000))+'</p>';row.replies=Array.from({length:12},(_,i)=>biliRow(String(i+2)));row.content.pictures=Array.from({length:12},()=>({img_src:'https://i0.hdslb.com/picture.jpg'}));
  const value=mapComment('bili',row,0,'123');assert.ok(value.text.length>2000);assert.ok(!value.text.includes('<p>'));assert.deepEqual(value.badges,['Creator','LV6']);assert.equal(value.emotes.length,1);assert.equal(value.pictures.length,9);assert.equal(value.previews.length,3);assert.deepEqual(value.previews[0].previews,[]);
  const net=mapComment('netease',{commentId:3,content:'こんにちは',time:1700000000000,user:{userId:1,nickname:'歌手'},beReplied:[{content:'你好',user:{nickname:'原作者'}}]});assert.equal(net.at,1700000000);assert.equal(net.quote.author,'原作者');assert.equal(net.quote.text,'你好');
  assert.equal(mapComment('qq',{CmId:'../../x'}),null);assert.equal(publicImage('bili','https://attacker.test/img.jpg'),null);assert.equal(publicImage('qq','https://y.gtimg.cn.evil.test/a.jpg'),null);
});
test('Bilibili pinned comments and reply pagination are distinct and malformed cursors stop before upstream calls',async()=>{
  const calls=[],p={bili:async(path,q)=>{calls.push({path,q});return path.endsWith('/view')?{data:{aid:999,owner:{mid:123}}}:{data:{top_replies:[biliRow('top')],replies:Array.from({length:20},(_,i)=>biliRow(String((q.pn-1)*20+i+1))),page:{count:45}}};}};
  const first=await comments(p,biliTrack);assert.equal(first.items[0].pinned,true);assert.equal(first.items.length,21);assert.equal(JSON.parse(first.next).page,2);
  const replies=await comments(p,biliTrack,{root:'1',cursor:first.next});assert.equal(replies.items.length,20);assert.equal(calls.at(-1).path,'/x/v2/reply/reply');assert.equal(calls.at(-1).q.root,'1');assert.equal(calls.at(-1).q.pn,2);
  for(const cursor of ['null','[]','{"page":0}','{"page":501}','{"page":1,"seq":"a\\nb"}'])assert.throws(()=>commentCursor(cursor),e=>e.code==='invalid-request');
  const before=calls.length;await assert.rejects(comments(p,biliTrack,{cursor:'bad'}),e=>e.code==='invalid-request');assert.equal(calls.length,before);
});
test('QQ comments preserve continuation tokens and only unavailable modern endpoints use legacy protocol',async()=>{
  const calls=[],root='1!J6NMnZSxHBtyj.eVarRu-a51PVKr1N24TOWU9fz4azKFdvKSsxD6vQmX.kDkcDIN',p={qq:async(module,method,q)=>{calls.push({method,q});return {CommentList:{HasMore:true,Comments:[{CmId:root,Content:'你好',Nick:'歌手',SeqNo:'seq',RankScore:'rank'}]},TotalCmNum:30,TotalVer:'v'};}};
  const first=await comments(p,qqTrack);assert.equal(first.items[0].id,root);assert.equal(JSON.parse(first.next).seq,'seq');await comments(p,qqTrack,{root,cursor:first.next});assert.equal(calls.at(-1).q.RootCmId,root);assert.equal(calls.at(-1).method,'GetReplyCommentList');assert.equal(calls.at(-1).q.LastRankScore,'rank');
  let fallback=0;p.net={json:async()=>{++fallback;return {code:0,hot_comment:{commenttotal:21,commentlist:Array.from({length:20},(_,i)=>({commentid:String(i+1),rootcommentcontent:'legacy'}))}};}};p.headers=()=>({});p.qq=async()=>{throw new PlatformError('verification','verify');};await assert.rejects(comments(p,qqTrack),e=>e.code==='verification');assert.equal(fallback,0);
  p.qq=async()=>{throw new PlatformError('unavailable','unsupported');};const legacy=await comments(p,qqTrack);assert.equal(JSON.parse(legacy.next).legacy,true);assert.equal(fallback,1);
});
test('NetEase comment floors preserve quoted parents and advance using their own time cursor',async()=>{
  const calls=[],p={netease:async(path,q)=>{calls.push({path,q});return {data:{comments:[{commentId:1,content:'回复',time:1700000000000,user:{nickname:'听众'}}],hasMore:true,time:'1700000000000',totalCount:2}};}};
  const first=await comments(p,netTrack,{root:'12'});assert.equal(JSON.parse(first.next).offset,'1700000000000');await comments(p,netTrack,{root:'12',cursor:first.next});assert.equal(calls.at(-1).q.time,'1700000000000');assert.equal(calls.at(-1).path,'/api/resource/comment/floor/get');
});
test('long QQ encrypted reply IDs and previews keep their platform punctuation without accepting path fragments',async()=>{
  const id='1!'+('Ab.Cd-'.repeat(24))+'*';assert.ok(id.length>128);
  const mapped=mapComment('qq',{CmId:'root',Content:'原评论',SubComments:[{CmId:id,Content:'长标识回复'}]});assert.equal(mapped.previews[0].id,id);
  const result=await comments({qq:async()=>({CommentList:{Comments:[{CmId:id,Content:'回复'}],HasMore:1,Total:21}})},qqTrack,{root:id});assert.equal(result.items[0].id,id);assert.ok(result.next);
  await assert.rejects(comments({},qqTrack,{root:'../../bad'}),e=>e.code==='invalid-request');
});
test('NetEase first reply page merges featured replies without duplicates and remains explicit when content is withheld',async()=>{
  const row={commentId:1,content:'精选回复',user:{nickname:'听众'}};const p={netease:async()=>({data:{bestComments:[row],comments:[row],hasMore:false,totalCount:1}})};
  assert.equal((await comments(p,netTrack,{root:'12'})).items.length,1);
  p.netease=async()=>({data:{bestComments:[row],comments:Array.from({length:20},(_,i)=>({...row,commentId:i+2})),hasMore:true,time:'new',totalCount:21}});const full=await comments(p,netTrack,{root:'12'});assert.equal(full.items.length,21);assert.equal(full.items.at(-1).id,'21');assert.ok(full.next);
  p.netease=async()=>({data:{comments:[],hasMore:false,totalCount:2}});assert.match((await comments(p,netTrack,{root:'12'})).notice,/unavailable|does not provide|no/i);
});
test('QQ collections preserve pagination and reject a mismatched returned playlist',async()=>{
  let query;const p={qq:async(module,method,q)=>{query=q;return {dissinfo:{disstid:123,dissname:'歌单',nick:'作者'},total_song_num:22,songlist:[{mid:'001AbCdefghij',title:'海风',singer:[{name:'歌手'}]}]};}};
  const data=await collection(p,'qq','123',2);assert.equal(query.song_begin,20);assert.equal(data.songs.length,1);assert.equal(data.more,true);assert.equal(data.playlist.owner,'作者');
  await assert.rejects(collection(p,'qq','999',1),e=>e.code==='invalid-response');await assert.rejects(collection(p,'qq','123',0),e=>e.code==='invalid-request');
  p.qq=async()=>({dirinfo:{id:123,title:'新的歌单字段',host_nick:'原作者',picurl:'https://y.gtimg.cn/cover.jpg',songnum:1},songlist:[{mid:'001AbCdefghij',title:'海风'}]});const mobile=await collection(p,'qq','123',1);assert.equal(mobile.playlist.title,'新的歌单字段');assert.equal(mobile.playlist.owner,'原作者');assert.ok(mobile.playlist.image);
});
test('Bilibili private folders require an account while video seasons remain independently browsable',async()=>{
  const calls=[],p={bili:async(path,q)=>{calls.push({path,q});return {data:{info:{title:'合集',media_count:22},medias:[{bvid:'BV1xx411c7mD',title:'海风',cover:'https://i0.hdslb.com/cover.jpg',upper:{mid:123,name:'UP'}},{title:'已失效'}],has_more:true}};}};
  await assert.rejects(collection(p,'bili','123',1,{cookies:{}}),e=>e.code==='sign-in');assert.equal(calls.length,0);
  const season=await collection(p,'bili','season_123',1);assert.equal(season.songs[0].creatorId,'123');assert.equal(season.unavailable,1);assert.equal(season.more,true);assert.equal(calls[0].q.season_id,'123');
  await collection(p,'bili','123',1,{cookies:{bili:'own'}});assert.equal(calls[1].path,'/x/v3/fav/resource/list');
});
test('NetEase playlists restore declared order and count missing or unavailable songs',async()=>{
  const p={netease:async(path,q)=>path.endsWith('/detail') && path.includes('playlist')?{playlist:{id:123,name:'歌单',creator:{nickname:'作者'},trackIds:[{id:1},{id:2},{id:3}],trackCount:3}}:{songs:[{id:3,name:'第三首',ar:[{name:'歌手'}]},{id:1,name:'第一首',ar:[{name:'歌手'}]}]}};
  const data=await collection(p,'netease','123',1);assert.deepEqual(data.songs.map(song=>song.remoteId),['1','3']);assert.equal(data.unavailable,1);assert.equal(data.more,false);await assert.rejects(collection(p,'netease','456',1),e=>e.code==='invalid-response');
});
async function serving(options,run){const gateway=createGateway(options),server=createServer((req,res)=>gateway(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));try{await run(`http://127.0.0.1:${server.address().port}`);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}}
test('public image gateway never sends account cookies and refuses untrusted, oversized or non-raster responses',async()=>{
  let kind='image/jpeg',size='4',calls=0,received;
  await serving({providers:{headers:(s,cookie)=>({Referer:'https://www.bilibili.com/',...(cookie?{Cookie:cookie}:{})})},fetcher:async(url,options)=>{++calls;received=options.headers;return new Response('jpeg',{headers:{'Content-Type':kind,'Content-Length':size}});}},async base=>{
    const health=await isolatedLoopback(base+'/api/health'),cookie=health.headers.get('set-cookie').split(';')[0];await health.json();await isolatedLoopback(base+'/api/account',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({source:'bili',cookie:'own-session'})});
    const address='/api/public-image?'+new URLSearchParams({source:'bili',address:'https://i0.hdslb.com/public.jpg'});let response=await isolatedLoopback(base+address,{headers:{Cookie:cookie}});assert.equal(response.status,200);await response.text();assert.equal(received.Cookie,undefined);
    assert.equal((await isolatedLoopback(base+'/api/public-image?source=bili&address=https://attacker.test/a.jpg')).status,400);assert.equal(calls,1);
    kind='image/svg+xml';assert.equal((await isolatedLoopback(base+address)).status,502);kind='image/jpeg';size=String(9*1024*1024);assert.equal((await isolatedLoopback(base+address)).status,502);
  });
});
test('account changes invalidate pending comments before old session data is exposed',async()=>{
  let resolve,started;const ready=new Promise(r=>started=r),pending=new Promise(r=>resolve=r);
  await serving({providers:{headers:()=>({}),bili:async(path)=>{if(path.endsWith('/view')){started();return pending;}return {data:{replies:[biliRow()],page:{count:1}}};}}},async base=>{
    const h=await isolatedLoopback(base+'/api/health'),cookie=h.headers.get('set-cookie').split(';')[0];await h.json();const headers={Cookie:cookie};const request=isolatedLoopback(base+'/api/comments?id=bili-BV1xx411c7mD',{headers});await ready;
    await isolatedLoopback(base+'/api/account',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({source:'bili',cookie:''})});resolve({data:{aid:1,owner:{mid:123}}});const response=await request;await response.arrayBuffer();assert.equal(response.status,409);
  });
});

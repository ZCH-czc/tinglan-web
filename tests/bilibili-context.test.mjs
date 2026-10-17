import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {parseBilibiliId,bilibiliPartId} from '../web/bilibili-id.mjs';
import {planBilibiliSelection} from '../web/bilibili-selection.mjs';
import {normalizeTrack} from '../web/library-data.mjs';
import {resolveBilibiliSegment} from '../server/bilibili-segment.mjs';
import {bilibiliContext} from '../server/bilibili-context.mjs';
import {PlatformProviders} from '../server/providers.mjs';
import {biliVideo,biliDanmaku} from '../server/bilibili-video.mjs';
import {comments} from '../server/comments.mjs';
import {createGateway} from '../server/gateway.mjs';

const bvid='BV1xx411c7mD',other='BV1yy411c7mD';
const view={bvid,aid:123,title:'海风与山间',pic:'https://i0.hdslb.com/cover.jpg',owner:{mid:1,name:'音乐人'},pages:[{page:1,cid:111,part:'海风',duration:30},{page:2,cid:222,part:'山间',duration:60}],ugc_season:{id:12,title:'音乐合集',ep_count:2,sections:[{episodes:[{bvid,title:'海风与山间',arc:{duration:90}},{bvid:other,title:'另一首歌',arc:{duration:40}},{bvid:other,title:'重复'}]}]}};
const part={source:'bili',id:'bili-'+bvid+'_cid_222',remoteId:bvid+'_cid_222'};
function provider() {
  const calls=[];
  const p={calls,bili:async(path,query)=>{
    calls.push({path,query});
    if(path.endsWith('/view'))return {data:view};
    if(path.endsWith('/playurl'))return {data:{dash:{duration:60,audio:[{baseUrl:'https://upos.bilivideo.com/audio.m4a'}],video:[{id:80,codecs:'avc1.640028',width:1920,height:1080,baseUrl:'https://upos.bilivideo.com/video.mp4'}]}}};
    if(path.endsWith('/v2'))return {data:{subtitle:{subtitles:[{lan:'zh-CN',subtitle_url:'https://i0.hdslb.com/subtitle.json'}]}}};
    return {data:{replies:[],page:{count:0}}};
  },headers:()=>({Referer:'https://www.bilibili.com/'}),net:{text:async(source,url)=>{assert.equal(url,'https://comment.bilibili.com/222.xml');return '<d p="1,1,25,0">山间</d>';},json:async()=>({body:[{from:1,content:'第二段字幕'}]})}};
  return p;
}
test('Bilibili identities accept Android CID form and reject ambiguous, zero, path and oversized IDs',()=>{
  assert.deepEqual(parseBilibiliId(bvid),{bvid,cid:''});assert.equal(bilibiliPartId(bvid,222),part.remoteId);
  for(const id of [bvid+'_cid_0',bvid+'_cid_0222',bvid+'_cid_'+ '1'.repeat(20),bvid+'/222',bvid+'_cid_222_extra',bvid+'_p2',null])assert.equal(parseBilibiliId(id),null);
});
test('segments must belong to the exact video and remain stable after page reorder',()=>{
  assert.equal(resolveBilibiliSegment(view,part.remoteId).cid,222);
  assert.equal(resolveBilibiliSegment({...view,pages:[...view.pages].reverse()},part.remoteId).cid,222);
  assert.throws(()=>resolveBilibiliSegment({...view,bvid:other},part.remoteId),e=>e.code==='invalid-response');
  assert.throws(()=>resolveBilibiliSegment(view,bvid+'_cid_999'),e=>e.code==='not-found');
  assert.throws(()=>resolveBilibiliSegment({...view,pages:[{cid:Number.MAX_SAFE_INTEGER+1}]},bvid),e=>e.code==='not-found');
});
test('audio, video, subtitles, artwork metadata and danmaku resolve the selected CID while comments use the parent BVID',async()=>{
  const p=provider();assert.equal((await PlatformProviders.prototype.stream.call(p,part)).cid,222);
  assert.equal((await biliVideo(p,part,80)).cid,222);
  assert.match((await PlatformProviders.prototype.lyrics.call(p,part)).text,/第二段字幕/);
  const metadata=await PlatformProviders.prototype.metadata.call(p,part);assert.equal(metadata.id,part.id);assert.equal(metadata.title,'P2 · 山间');assert.equal(metadata.durationMs,60000);
  assert.equal((await biliDanmaku(p,part)).items[0].text,'山间');await comments(p,part);
  assert.ok(p.calls.filter(row=>row.path.endsWith('/view')).every(row=>row.query.bvid===bvid));
  assert.ok(p.calls.filter(row=>row.path.endsWith('/playurl') || row.path.endsWith('/v2')).every(row=>row.query.cid===222 && row.query.bvid===bvid));
});
test('context preserves first-page identity, maps the selected page and deduplicates current collection episodes',async()=>{
  const data=await bilibiliContext(provider(),part);assert.equal(data.parts.length,2);assert.equal(data.parts[0].song.id,'bili-'+bvid);assert.equal(data.parts[1].song.id,part.id);assert.equal(data.cid,'222');
  assert.equal(data.collection.id,'season_12');assert.equal(data.collection.songs.length,2);assert.equal(data.collection.partial,false);
  const first=normalizeTrack({...data.parts[1].song,size:0});assert.equal(first.remoteId,part.remoteId);
  for(const id of [bvid+'_cid_0',bvid+'_cid_999x'])assert.throws(()=>normalizeTrack({...data.parts[1].song,id:'bili-'+id,remoteId:id,size:0}));
});
test('selection plans validate context ownership and preserve position when selecting the already active segment',async()=>{
  const data=await bilibiliContext(provider(),part);
  const plan=planBilibiliSelection(data,'bili-'+bvid,part.id,'parts');assert.equal(plan.same,false);assert.deepEqual(plan.ids,['bili-'+bvid,part.id]);
  assert.equal(planBilibiliSelection(data,part.id,part.id).same,true);
  const alias=planBilibiliSelection(data,'bili-'+bvid+'_cid_111','bili-'+bvid);assert.equal(alias.same,true);assert.equal(alias.id,'bili-'+bvid+'_cid_111');assert.ok(alias.ids.includes(alias.id));
  const next=planBilibiliSelection(data,part.id,'bili-'+other,'collection');assert.equal(next.same,false);assert.equal(next.ids.length,2);
  assert.throws(()=>planBilibiliSelection(data,'bili-'+other,part.id));assert.throws(()=>planBilibiliSelection(data,part.id,'bili-'+other,'parts'));
});
test('partial collection metadata and bounded pages remain explicit, and malformed episodes never become tracks',async()=>{
  const p=provider();p.bili=async()=>({data:{...view,pages:Array.from({length:1001},(_,i)=>({cid:i+1,part:'段落',duration:1})),ugc_season:{...view.ugc_season,ep_count:5000,sections:[{episodes:[{bvid:'invalid',title:'bad'},{bvid:other,title:'有效'}]}]}}});
  const data=await bilibiliContext(p,{remoteId:bvid});assert.equal(data.parts.length,1000);assert.match(data.warning,/1000/);assert.equal(data.collection.partial,true);assert.equal(data.collection.songs.length,1);
});
test('fresh gateway resolves segmented IDs without catalog state and hides all upstream media URLs',async()=>{
  const p=provider();p.stream=(track,session)=>PlatformProviders.prototype.stream.call(p,track,session);p.lyrics=(track,session)=>PlatformProviders.prototype.lyrics.call(p,track,session);
  const server=createServer((req,res)=>createHandle(req,res));const createHandle=createGateway({providers:p});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  async function request(path,cookie='') {
    try{const response=await fetch(base+path,{headers:{Connection:'close',...(cookie?{Cookie:cookie}:{})},signal:AbortSignal.timeout(5000)});const value=await response.json();return {response,value};}
    catch(error){throw new Error(`Local segmented gateway ${path.split('?')[0]}: ${error.cause?.code || error.code || error.name}`,{cause:error});}
  }
  try {
    const {response}=await request('/api/health'),cookie=response.headers.get('set-cookie').split(';')[0];
    const {value:audio}=await request('/api/stream?'+new URLSearchParams({id:part.id}),cookie);assert.match(audio.url,/^\/api\/media\/\w+$/);assert.ok(!JSON.stringify(audio).includes('bilivideo'));
    const {value:context}=await request('/api/bili-context?'+new URLSearchParams({id:part.id}),cookie);assert.equal(context.cid,'222');
    assert.equal((await request('/api/stream?'+new URLSearchParams({id:'bili-'+bvid+'_cid_999'}),cookie)).response.status,404);
    assert.equal((await request('/api/bili-context?id=qq-001N2Ymh2QMeI2',cookie)).response.status,400);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {liveDetail,parseLiveManifest,liveDescription,roomFromLink,liveManifest,validRoom} from '../server/bilibili-live.mjs';
import {LiveResources} from '../server/live-resources.mjs';
import {createGateway} from '../server/gateway.mjs';
import {PlatformProviders} from '../server/providers.mjs';
import {PlatformError} from '../server/upstream.mjs';
import {LivePlayback,liveRoomFromLink} from '../web/live-playback.mjs';
import {LIVE_HLS_CONFIG,attachLiveHls} from '../web/hls-adapter.mjs';
import {normalizePreferences} from '../web/library-data.mjs';
import {EventEmitter} from 'node:events';

test('single-level HLS reports persistent real drops once and ignores pause/buffering samples',()=>{
  const handlers=new Map(),failures=[];class FakeHls {static isSupported(){return true;}static Events={ERROR:'error',MANIFEST_PARSED:'parsed',FPS_DROP:'fps'};static ErrorTypes={};levels=[{}];on(name,fn){handlers.set(name,fn)}attachMedia(){}loadSource(){}startLoad(){}stopLoad(){}destroy(){}}
  const video={paused:false,seeking:false,readyState:3};const adapter=attachLiveHls(video,'/api/live-media/test',(error,details)=>failures.push({error,details}),new AbortController().signal,FakeHls);adapter.start();const sample=()=>handlers.get('fps')('',{currentDecoded:100,currentDropped:40});video.readyState=2;sample();sample();assert.equal(failures.length,0);video.readyState=3;sample();assert.equal(failures.length,0);sample();assert.equal(failures.length,1);sample();assert.equal(failures.length,1);assert.equal(failures[0].details.performance,true);adapter.destroy();sample();assert.equal(failures.length,1);
});

const ROOT='https://live.bilivideo.com/live/test/index.m3u8?secret=private',session={id:'local',cookies:{bili:'DedeUserID=123'},generation:0};
function manifest(){return {live_status:1,playurl_info:{playurl:{g_qn_desc:[{qn:80,desc:'流畅'},{qn:10000,desc:'原画'}],stream:[{protocol_name:'http_hls',format:[{format_name:'ts',codec:[{codec_name:'avc',current_qn:80,base_url:'/live/test/index.m3u8',url_info:[{host:'https://live.bilivideo.com',extra:'?secret=private'}]}]}]}]}}};}
const details=()=>({data:{room_info:{room_id:567,uid:123,title:'<b>海风</b>',live_status:1,online:42,description:'<p>一起听歌</p><p>第二行&nbsp;&#x1f3b5;</p><script>bad()</script>',area_name:'音乐'},anchor_info:{base_info:{uname:'UP 主',face:'https://i0.hdslb.com/a.jpg'}}}});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function serving(options,run){const gateway=createGateway(options),server=createServer((req,res)=>gateway(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));try{await run(`http://127.0.0.1:${server.address().port}`);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}}

test('live room inputs remain lossless strings and only explicit live URLs are accepted',()=>{
  for(const id of ['123','123456789012345678','https://live.bilibili.com/123?from=share'])assert.equal(roomFromLink(id),liveRoomFromLink(id));
  for(const id of [123,'0','-1','1'.repeat(19),'https://live.bilibili.com.evil.test/123','https://name@live.bilibili.com/123','http://live.bilibili.com/123','javascript:123','https://live.bilibili.com/123/456']){assert.equal(roomFromLink(id),'');assert.equal(liveRoomFromLink(id),'');}
  assert.equal(validRoom(123),false);
});
test('live details canonicalise short room numbers and render HTML as bounded readable paragraphs',async()=>{
  const calls=[],room=await liveDetail({biliLive:async(path,q)=>{calls.push({path,q});return details();}},'12',session);
  assert.equal(room.roomId,'567');assert.equal(room.requestedId,'12');assert.equal(room.creatorId,'123');assert.equal(room.live,true);assert.equal(room.description,'一起听歌\n第二行 🎵');assert.equal(room.title,'海风');assert.match(room.avatar.path,/public-image/);assert.match(calls[0].path,/getH5InfoByRoom/);
  assert.equal(liveDescription('x'.repeat(30000)).length,8000);
  assert.equal(room.area,'音乐');
  assert.equal(liveDescription('&lt;p&gt;第一行&nbsp;&lt;/p&gt;&lt;p&gt;第二行&lt;/p&gt;'),'第一行\n第二行');
  assert.equal(liveDescription('&lt;script&gt;bad()&lt;/script&gt;<p>安全内容</p>'),'安全内容');
});
test('live manifests expose actual qualities and permit only HTTPS HLS streams from trusted media CDNs',()=>{
  const data=manifest();data.playurl_info.playurl.stream[0].format[0].codec[0].url_info.push({host:'https://attacker.test',extra:''},{host:'http://live.bilivideo.com',extra:''});
  const parsed=parseLiveManifest(data);assert.equal(parsed.streams.length,1);assert.equal(parsed.streams[0].urls.length,1);assert.equal(parsed.streams[0].codec,'avc');assert.equal(parsed.qualities[1].id,10000);
  data.playurl_info.playurl.stream[0].protocol_name='http_stream';assert.equal(parseLiveManifest(data).streams.length,0);
});
test('live protocol signing uses live API origin and verification terminates without endpoint fallback',async()=>{
  const calls=[],p=new PlatformProviders({json:async(source,address)=>{calls.push(address);return {code:0,data:manifest()};}});p.biliKey='a'.repeat(32);p.biliExpiry=Date.now()+10000;
  await liveManifest(p,'123',10000,session);assert.match(calls[0],/^https:\/\/api.live.bilibili.com\/xlive\/web-room\/v2\/index\/getRoomPlayInfo/);assert.match(calls[0],/qn=10000/);assert.match(calls[0],/w_rid=/);
  let count=0;await assert.rejects(liveManifest({biliLive:async()=>{count++;throw new PlatformError('verification','验证',429);}},'123',80,session),e=>e.code==='verification');assert.equal(count,1);
  await assert.rejects(liveManifest(p,'../1',80,session),e=>e.code==='invalid-request');await assert.rejects(liveManifest(p,'123',Infinity,session));
});
test('nested HLS playlists, keys, maps and segments become opaque bounded local capabilities',()=>{
  const resources=new LiveResources(),path=resources.register(ROOT,'a'),key=path.split('/')[3],g=resources.grants.get(key);
  const raw='#EXTM3U\n#comment https://private.test/key\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvariant.m3u8?token=private\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8"';
  const rewritten=resources.rewrite(raw,ROOT,key,g,0);assert.equal(rewritten.includes('private'),false);assert.equal(rewritten.includes('bilivideo'),false);assert.equal(g.entries.size,3);
  const media=resources.rewrite('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2,\nfile.ts',ROOT,key,g,1);assert.equal(media.includes('/api/live-media/'),true);assert.equal([...g.entries.values()].some(e=>e.kind==='key'),true);
  for(const text of ['#EXTM3U\nhttps://attacker.test/a.ts','#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"','#EXTM3U\n#EXT-X-MAP:URI="file:///x"','#EXTM3U\nhttp://live.bilivideo.com/a.ts'])assert.throws(()=>resources.rewrite(text,ROOT,key,g,0));
  assert.throws(()=>resources.rewrite('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nnext.m3u8',ROOT,key,g,4));
});
test('live grant storage evicts old resources and respects session revocation and expiry',()=>{
  let now=1;const r=new LiveResources({now:()=>now});for(let i=0;i<10;i++)r.register(ROOT+'-'+i,'a');assert.equal(r.grants.size,8);
  const [key,g]=[...r.grants][0];for(let i=0;i<700;i++)r.entry(key,g,ROOT+'&i='+i,'segment',0);assert.equal(g.entries.size,512);assert.equal(g.byUrl.size,512);
  r.register(ROOT,'b');r.revokeSession('a');assert.equal(r.grants.size,1);now+=1800001;r.prune();assert.equal(r.grants.size,0);
});
test('regularly refreshed live playlists survive long-running segment eviction',async()=>{
  const r=new LiveResources({fetcher:async()=>new Response(null,{status:200})}),path=r.register(ROOT,'a'),key=path.split('/')[3],g=r.grants.get(key);
  for(let i=0;i<700;i++){if(i%50===0){const res=new (await import('node:events')).EventEmitter();res.writeHead=()=>{};res.end=()=>{};await r.serve({method:'HEAD',headers:{}},res,path,'a');}r.entry(key,g,ROOT+'&i='+i,'segment',0);}
  assert.equal(g.entries.has(path.split('/')[4]),true);assert.equal(g.entries.size,512);
});

test('active live grants survive two hours while idle and foreign-session grants cannot renew',async()=>{
  let now=1;const r=new LiveResources({now:()=>now,fetcher:async()=>new Response(null,{status:200})}),path=r.register(ROOT,'a'),key=path.split('/')[3];
  const reply=()=>{const res=new EventEmitter();res.writeHead=()=>{};res.end=()=>{};return res;};
  for(let elapsed=0;elapsed<8;elapsed++){now+=15*60*1000;await r.serve({method:'HEAD',headers:{}},reply(),path,'a');assert.equal(r.grants.has(key),true);}
  const expiry=r.grants.get(key).expiry;now+=60*1000;
  await assert.rejects(r.serve({method:'HEAD',headers:{}},reply(),path,'b'),error=>error.code==='expired');assert.equal(r.grants.get(key).expiry,expiry);
  now=expiry+1;await assert.rejects(r.serve({method:'HEAD',headers:{}},reply(),path,'a'),error=>error.code==='expired');assert.equal(r.grants.has(key),false);
});
test('live HTTP grants rewrite responses, preserve ranges, reject other sessions and never leak cookies',async()=>{
  const calls=[],providers={biliLive:async(path)=>path.endsWith('getH5InfoByRoom')?details():{data:manifest()},headers:()=>({'User-Agent':'fixture'})};
  await serving({providers,fetcher:async(url,options)=>{calls.push({url,options});return new Response(url.includes('.m3u8')?'#EXTM3U\n#EXTINF:2,\nseg.ts':new Uint8Array([1,2,3]),{status:options.headers.Range?206:200,headers:options.headers.Range?{'content-range':'bytes 0-2/3'}:{}});}},async base=>{
    const info=await fetch(base+'/api/live-room?room=12'),cookie=info.headers.get('set-cookie').split(';')[0];assert.equal((await info.json()).roomId,'567');
    const source=await (await fetch(base+'/api/live-stream?room=567',{headers:{cookie}})).json(),url=source.streams[0].url;assert.equal(JSON.stringify(source).includes('secret'),false);
    const text=await (await fetch(base+url,{headers:{cookie}})).text(),segment=text.split('\n').at(-1);assert.match(segment,/^\/api\/live-media\//);
    assert.equal((await fetch(base+segment)).status,410);
    const response=await fetch(base+segment,{headers:{cookie,Range:'bytes=0-2'}});assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 0-2/3');assert.equal((await response.arrayBuffer()).byteLength,3);
    assert.equal(calls.every(c=>!('Cookie' in c.options.headers)),true);
    await fetch(base+'/api/account',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({source:'bili',cookie:''})});assert.equal((await fetch(base+url,{headers:{cookie}})).status,410);
  });
});
test('live redirects to untrusted hosts and verification responses stop at the first failure',async()=>{
  for(const status of [302,403,429]){let calls=0;const r=new LiveResources({fetcher:async()=>{calls++;return new Response(null,{status,headers:{location:'https://attacker.test/private'}});}}),path=r.register(ROOT,'a');
    const res=new (await import('node:events')).EventEmitter();await assert.rejects(r.serve({method:'GET',headers:{}},res,path,'a'));assert.equal(calls,1);
  }
});

class FakeVideo extends EventTarget {
  constructor(){super();this.volume=.8;this.paused=true;this.src='';}load(){}removeAttribute(){this.src='';}pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}async play(){this.paused=false;this.dispatchEvent(new Event('playing'));}
}
function playback(options={}) {
  const video=new FakeVideo(),events=[],token={id:'music',position:42000,playing:true};let hidden=false;
  const music={audio:{volume:.5},suspend:()=>{events.push('suspend');return token;},resume:async(value,args)=>{events.push(['resume',value,args]);}};
  const context=new LivePlayback({video,music,loadRoom:async id=>({roomId:id,live:true}),loadSource:async()=>({live:true,qualities:[{id:80,label:'流畅'}],streams:[{quality:80,label:'流畅',codec:'avc',format:'ts',url:'/api/live-media/fixture'}]}),attach:async()=>({destroy(){events.push('destroy');},stop(){events.push('stop');},start(){events.push('start');}}),revoke:url=>events.push(['revoke',url]),hidden:()=>hidden,...options});
  return {context,video,events,token,hidden:value=>hidden=value};
}
test('entering a live room automatically attempts playback and returning destroys it before music resumes',async()=>{
  const c=playback();await c.context.open('123');assert.equal(c.events[0],'suspend');assert.equal(c.context.state.status,'playing');assert.equal(c.video.volume,.5);
  await c.context.close();assert.ok(c.events.indexOf('destroy')<c.events.findIndex(e=>Array.isArray(e)&&e[0]==='resume'));assert.deepEqual(c.events.at(-1),['resume',c.token,{play:true}]);assert.equal(c.context.active,false);
});
test('100 rapid live changes cancel requests and only the newest room can start its decoder',async()=>{
  const pending=new Map(),c=playback({loadRoom:(id,signal)=>{const d=deferred();pending.set(id,{...d,signal});return d.promise;}}),tasks=[];
  for(let i=1;i<=100;i++)tasks.push(c.context.open(String(i)));
  assert.equal(pending.get('1').signal.aborted,true);pending.get('100').resolve({roomId:'100',live:true});await tasks[99];
  for(let i=1;i<100;i++)pending.get(String(i)).resolve({roomId:String(i),live:true});await Promise.all(tasks);
  assert.equal(c.context.state.roomId,'100');assert.equal(c.events.filter(e=>e==='suspend').length,1);assert.equal(c.events.filter(e=>e==='start').length,1);await c.context.close();
});
test('closing during source or decoder attachment releases stale grants and cannot restart playback',async()=>{
  const source=deferred(),c=playback({loadSource:()=>source.promise});const task=c.context.open('123');await Promise.resolve();await c.context.close();source.resolve({live:true,streams:[{url:'/api/live-media/stale'}]});await task;assert.equal(c.video.paused,true);assert.ok(c.events.some(e=>e[0]==='revoke'));
  const attach=deferred(),d=playback({attach:()=>attach.promise});const next=d.context.open('123');for(let i=0;i<4;i++)await Promise.resolve();await d.context.close();let released=false;attach.resolve({destroy(){released=true;}});await next;assert.equal(released,true);assert.equal(d.video.paused,true);
});
test('background live playback stops fetching and decoding without losing the explicit pause intent',async()=>{
  const c=playback();await c.context.open('123');c.hidden(true);c.context.visibility();assert.equal(c.video.paused,true);assert.equal(c.context.desired,true);assert.ok(c.events.includes('stop'));
  c.context.pause();c.hidden(false);c.context.visibility();await Promise.resolve();assert.equal(c.video.paused,true);assert.equal(c.context.desired,false);await c.context.close();
});
test('pausing during live load and changing quality while paused never silently starts playback',async()=>{
  const room=deferred(),c=playback({loadRoom:()=>room.promise});const task=c.context.open('123');c.context.pause();room.resolve({roomId:'123',live:true});await task;assert.equal(c.video.paused,true);assert.equal(c.context.desired,false);
  await c.context.open('123',80,{play:false});assert.equal(c.video.paused,true);await c.context.close();
});
test('live buffering timeout stops the loader and leaving cancels watchdog ownership',async()=>{
  const timers=new Map();let serial=0;const c=playback({setTimer:fn=>{timers.set(++serial,fn);return serial;},clearTimer:id=>timers.delete(id)});await c.context.open('123');assert.equal(timers.size,0);
  c.video.dispatchEvent(new Event('waiting'));assert.equal(timers.size,1);[...timers.values()][0]();assert.equal(c.context.state.status,'reconnecting');assert.match(c.context.state.notice,/timed out|timeout/i);await c.context.close();assert.equal(timers.size,0);
});
test('offline rooms, unsupported codecs and autoplay denial have actionable states instead of infinite loaders',async()=>{
  const offline=playback({loadRoom:async id=>({roomId:id,live:false})});await offline.context.open('123');assert.equal(offline.context.state.status,'ended');await offline.context.close();
  const codec=playback({supported:()=>false});await codec.context.open('123');assert.equal(codec.context.state.status,'error');await codec.context.close();
  const blocked=playback();blocked.video.play=async()=>{throw Object.assign(new Error('blocked'),{name:'NotAllowedError'});};await blocked.context.open('123');assert.equal(blocked.context.state.status,'paused');assert.match(blocked.context.state.error,/Tap Play/i);await blocked.context.close({resume:false});assert.equal(blocked.events.at(-1)[2].play,false);
});
test('live HLS has bounded buffers and no automatic HTTP retry; media recovery is limited to one attempt',()=>{
  for(const name of ['manifestLoadPolicy','playlistLoadPolicy','fragLoadPolicy','keyLoadPolicy'])assert.equal(LIVE_HLS_CONFIG[name].default.errorRetry,null);
  let recover=0,destroy=0,stop=0,handler,failed=[];
  class HlsFake {static isSupported(){return true;}static Events={ERROR:'error'};static ErrorTypes={MEDIA_ERROR:'media',NETWORK_ERROR:'network'};on(_,fn){handler=fn;}attachMedia(){}loadSource(){}recoverMediaError(){recover++;}destroy(){destroy++;}stopLoad(){stop++;}startLoad(){}}
  const adapter=attachLiveHls(new FakeVideo(),'/api/live-media/test',error=>failed.push(error),new AbortController().signal,HlsFake);
  handler('error',{fatal:true,type:'media'});handler('error',{fatal:true,type:'media'});handler('error',{fatal:true,type:'network'});assert.equal(recover,1);assert.equal(failed.length,2);assert.equal(stop,2);adapter.destroy();adapter.destroy();assert.equal(destroy,1);
});
test('HLS authorization failures stop immediately even before the decoder labels them fatal',()=>{
  let stopped=0,handler,failures=0;class HlsFake {static isSupported(){return true;}static Events={ERROR:'error'};static ErrorTypes={MEDIA_ERROR:'media',NETWORK_ERROR:'network'};on(_,fn){handler=fn;}attachMedia(){}loadSource(){}stopLoad(){stopped++;}destroy(){}}
  const adapter=attachLiveHls(new FakeVideo(),'/api/live-media/test',()=>failures++,new AbortController().signal,HlsFake);handler('error',{fatal:false,type:'network',response:{code:401}});assert.equal(stopped,1);assert.equal(failures,1);adapter.destroy();
});
test('live quality preferences survive normalization without accepting invalid or unbounded values',()=>{
  assert.equal(normalizePreferences({liveQuality:10000}).liveQuality,10000);for(const value of [-1,1,30001,Infinity,'10000'])assert.equal(normalizePreferences({liveQuality:value}).liveQuality,80);
});

test('paused quality changes defer HLS network work and resume an interrupted manifest once',()=>{
  const events=new Map();let loads=0,starts=0,stops=0;
  class HlsFake {static isSupported(){return true;}static Events={ERROR:'error',MANIFEST_PARSED:'parsed'};static ErrorTypes={MEDIA_ERROR:'media',NETWORK_ERROR:'network'};on(name,fn){events.set(name,fn);}attachMedia(){}loadSource(){loads++;}startLoad(){starts++;}stopLoad(){stops++;}destroy(){}}
  const adapter=attachLiveHls(new FakeVideo(),'/api/live-media/test',()=>assert.fail('unexpected failure'),new AbortController().signal,HlsFake);
  adapter.stop();assert.equal(loads,0,'changing quality while paused must not start a manifest');
  adapter.start();adapter.start();assert.equal(loads,1);assert.equal(starts,1);
  adapter.stop();adapter.start();assert.equal(loads,2,'resume restarts a canceled initial manifest');
  events.get('parsed')();adapter.stop();adapter.start();assert.equal(loads,2,'parsed manifests only resume segment loading');
  adapter.destroy();adapter.start();assert.equal(starts,3);assert.ok(stops>=3);
});


test('closing live while audio processing prepares cannot steal resumed music ownership',async()=>{const c=playback(),gate=deferred();c.context.beforePlay=()=>gate.promise;const pending=c.context.open('123');await new Promise(resolve=>setImmediate(resolve));await c.context.close();gate.resolve();await pending;assert.equal(c.video.paused,true);assert.equal(c.context.active,false);assert.equal(c.events.filter(e=>Array.isArray(e)&&e[0]==='resume').length,1);});

test('live decoder fallback uses at most three authorised representations and leaves network failures stopped',async()=>{
  const callbacks=[],starts=[],streams=[0,1,2,3].map(i=>({quality:80,label:'流畅',codec:'avc',format:'ts',url:'/candidate/'+i}));
  const c=playback({loadSource:async()=>({live:true,streams}),attach:async(video,url,failed)=>{starts.push(url);callbacks.push(failed);return {destroy(){},start(){},stop(){}};}});
  await c.context.open('123');callbacks[0]('decoder',{recoverable:true});await new Promise(r=>setImmediate(r));assert.equal(starts.length,2);
  callbacks[0]('stale decoder',{recoverable:true});await new Promise(r=>setImmediate(r));assert.equal(starts.length,2);
  callbacks[1]('decoder',{recoverable:true});await new Promise(r=>setImmediate(r));callbacks[2]('decoder',{recoverable:true});await new Promise(r=>setImmediate(r));assert.equal(starts.length,3);assert.equal(c.context.state.status,'error');await c.context.close();
  const network=playback({loadSource:async()=>({live:true,streams}),attach:async(video,url,failed)=>{callbacks.push(failed);return {destroy(){},start(){},stop(){}};}});
  await network.context.open('123');callbacks.at(-1)('需要验证');await new Promise(r=>setImmediate(r));assert.equal(network.context.candidateIndex,0);assert.equal(network.context.state.status,'error');assert.equal(network.context.desired,false);await network.context.close();
});
test('a synchronous live attach failure cannot be overwritten by the resolved decoder',async()=>{
  let destroyed=false;const c=playback({attach:async(video,url,failed)=>{failed('需要验证');return {destroy(){destroyed=true;},start(){assert.fail('must not start');}};}});
  await c.context.open('123');assert.equal(c.context.state.status,'error');assert.equal(c.context.adapter,null);assert.equal(destroyed,true);await c.context.close();
});
test('pause and close during a fallback prevent its delayed decoder from restarting',async()=>{
  const next=deferred(),streams=[0,1].map(i=>({quality:80,label:'流畅',codec:'avc',url:'/candidate/'+i}));let failed,attached=0,destroyed=false;
  const c=playback({loadSource:async()=>({live:true,streams}),attach:async(video,url,callback)=>{failed=callback;if(attached++)return next.promise;return {destroy(){},start(){},stop(){}};}});
  await c.context.open('123');failed('decode',{recoverable:true});c.context.pause();await c.context.close();next.resolve({destroy(){destroyed=true;},start(){assert.fail('stale');}});await new Promise(r=>setImmediate(r));assert.equal(destroyed,true);assert.equal(c.context.active,false);
});

test('native video network errors schedule bounded reconnection without opening another codec immediately',async()=>{
  let attachments=0;const streams=[0,1].map(i=>({quality:80,label:'流畅',codec:'avc',url:'/candidate/'+i}));
  const c=playback({loadSource:async()=>({live:true,streams}),attach:async()=>{attachments++;return {destroy(){},start(){},stop(){}};}});
  await c.context.open('123');c.video.error={code:2};c.video.dispatchEvent(new Event('error'));await new Promise(r=>setImmediate(r));
  assert.equal(attachments,1);assert.equal(c.context.state.status,'reconnecting');assert.equal(c.context.desired,true);await c.context.close();
});


test('live reconnect is bounded, respects pause and never retries authorization failures',async()=>{
  const timers=new Map();let serial=0,callback,starts=0;
  const c=playback({setTimer:(fn,ms)=>{timers.set(++serial,{fn,ms});return serial;},clearTimer:id=>timers.delete(id),attach:async(v,url,failed)=>{callback=failed;starts++;return {destroy(){},start(){},stop(){}};}});
  const runRetry=async()=>{const [id,t]=[...timers].find(([,t])=>t.ms===1000 || t.ms===3000);timers.delete(id);t.fn();await new Promise(r=>setImmediate(r));};
  await c.context.open('123');callback('暂时断网',{transient:true});assert.equal(c.context.state.status,'reconnecting');await runRetry();assert.equal(starts,2);
  callback('暂时断网',{transient:true});await runRetry();assert.equal(starts,3);callback('仍然断网',{transient:true});assert.equal(c.context.state.status,'error');assert.equal(timers.size,0);
  await c.context.open('123');callback('暂时断网',{transient:true});c.context.pause();assert.equal(timers.size,0);assert.equal(c.context.desired,false);
  c.context.toggle();await new Promise(r=>setImmediate(r));callback('需要验证');assert.equal(c.context.state.status,'error');assert.equal(timers.size,0);await c.context.close();
});

test('hidden live reconnect defers all new network work until visible and keeps the same music suspension',async()=>{
  let callback,starts=0;const c=playback({attach:async(v,url,failed)=>{callback=failed;starts++;return {destroy(){},start(){},stop(){}};}});
  await c.context.open('123');c.hidden(true);callback('暂时断网',{transient:true});assert.equal(c.context.state.status,'reconnecting');assert.equal(starts,1);
  c.context.visibility();c.hidden(false);c.context.visibility();await new Promise(r=>setImmediate(r));assert.equal(starts,2);assert.equal(c.events.filter(x=>x==='suspend').length,1);await c.context.close();
});


test('a late native live play promise cannot restart sound after closing the live page',async()=>{
  const gate=deferred(),c=playback();let entered=false;c.video.play=async()=>{entered=true;await gate.promise;c.video.paused=false;};const pending=c.context.open('123');await new Promise(r=>setImmediate(r));assert.equal(entered,true);await c.context.close();gate.resolve();await pending;assert.equal(c.video.paused,true);assert.equal(c.context.active,false);
});

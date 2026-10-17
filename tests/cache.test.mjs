import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {LibraryStore} from '../web/storage.mjs';
import {CacheStore} from '../web/cache-storage.mjs';
import {CachePressure,cacheBudget,cacheKind,cacheTotals,evictionPlan} from '../web/cache-policy.mjs';
import {DownloadQueue} from '../web/download-queue.mjs';
import {MediaCache} from '../web/media-cache.mjs';
import {normalizeTrack,normalizePreferences,DEFAULTS} from '../web/library-data.mjs';
import {createBackup,readBackup} from '../web/backup.mjs';
import {SnapshotBridge} from '../web/snapshot-bridge.mjs';
import {RouteHistory} from '../web/navigation.mjs';

const id='qq-001CacheOne',url='/api/media/'+'a'.repeat(48);
const track=(suffix='001CacheOne',mode='',size=0,extra={})=>normalizeTrack({id:'qq-'+suffix,remoteId:suffix,source:'qq',title:'缓存样本',artist:'听岚',size,cached:!!mode,cacheMode:mode,type:'audio/wav',addedAt:1,cacheTouchedAt:1,...extra});
const wav=(size=64)=>{const bytes=new Uint8Array(size);bytes.set(new TextEncoder().encode('RIFF'),0);bytes.set(new TextEncoder().encode('WAVE'),8);return new Blob([bytes],{type:'audio/wav'});};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(){globalThis.indexedDB=new IDBFactory();const store=new LibraryStore();await store.open();return {store,cache:new CacheStore(store)};}
async function put(store,suffix,mode,size=64,extra={}){const row=track(suffix,mode,size,extra);await store.putTrack(row,wav(size));return row;}
function queue(options={}){return new DownloadQueue({ensure:async value=>track(value.slice(3)),resolve:async()=>({url,type:'audio/wav'}),fetcher:async()=>new Response(wav(),{headers:{'Content-Type':'audio/wav','Content-Length':'64'}}),save:async(value,blob,options)=>({saved:track(value.slice(3),options.mode,blob?.size || 64),updates:[]}),...options});}

test('cache pressure mirrors native thresholds, needs the matching acknowledgment and survives cleanup',()=>{
  const pressure=new CachePressure();assert.equal(pressure.observe(899,1000),null);const notice=pressure.observe(900,1000);assert.ok(notice);pressure.observe(10,1000);assert.equal(pressure.notice,notice);pressure.acknowledge('old');assert.equal(pressure.notice,notice);pressure.acknowledge(notice.token);assert.equal(pressure.notice,null);
  const next=pressure.observe(950,1000);pressure.acknowledge(next.token);pressure.observe(890,1000);assert.equal(pressure.observe(920,1000),null);pressure.observe(740,1000);assert.notEqual(pressure.observe(910,1000).token,next.token);pressure.acknowledge(pressure.notice.token);assert.equal(pressure.observe(10000,Infinity),null);assert.equal(cacheBudget(-1),Infinity);assert.equal(cacheBudget(1024),1073741824);
});
test('legacy cached online audio is a retained download; LRU never selects local/manual/current/next/favorites',()=>{
  const rows=[track('legacy','download',5),track('playing','automatic',5),track('nextone','automatic',5),track('likedone','automatic',5,{favorite:true}),track('oldest','automatic',5,{cacheTouchedAt:1}),track('recent','automatic',5,{cacheTouchedAt:100}),{id:'local-one',source:'local',size:5,cached:true}];delete rows[0].cacheMode;
  assert.equal(cacheKind(rows[0]),'download');assert.deepEqual(evictionPlan(rows,{target:20,protectedIds:new Set(['qq-playing','qq-nextone'])}).remove.map(row=>row.id),['qq-oldest']);assert.equal(cacheTotals(rows).localBytes,5);assert.equal(evictionPlan(rows,{target:0,protectedIds:new Set(['qq-playing','qq-nextone'])}).blocked,true);
});
test('audio, lyrics and both artwork sizes commit together without replacing concurrent metadata edits',async()=>{
  const {store,cache}=await fixture();await store.putTrack(track());await store.patchTrack(id,{favorite:true,title:'用户标题',lyricsEdited:true,lyrics:'[00:01]用户歌词'});
  const result=await cache.save(id,wav(),{assets:{lyrics:{text:'平台歌词',source:'qq'},artwork:[new Blob(['cover']),new Blob(['thumb'])]}});
  const row=await store.read('tracks',id);assert.equal(row.favorite,true);assert.equal(row.title,'用户标题');assert.equal(row.lyrics,'[00:01]用户歌词');assert.equal(row.cacheMode,'download');assert.equal(row.size,64);assert.equal((await store.read('media',id)).size,64);assert.equal(await (await store.read('artwork',id+':thumb')).text(),'thumb');assert.equal(result.saved.hasArtwork,true);store.db.close();
});
test('asset collection repairs missing artwork but preserves an existing custom cover pair',async()=>{
  const {store,cache}=await fixture();await store.putTrack(track('001CacheOne','',0,{hasArtwork:true}));await cache.save(id,wav(),{assets:{artwork:[new Blob(['fresh']),new Blob(['small'])]}});assert.equal(await (await store.read('artwork',id)).text(),'fresh');
  await store.setArtwork(id,new Blob(['custom']),new Blob(['custom-thumb']));await cache.save(id,null,{assets:{artwork:[new Blob(['obsolete']),new Blob(['obsolete'])]}});assert.equal(await (await store.read('artwork',id)).text(),'custom');assert.equal(await (await store.read('artwork',id+':thumb')).text(),'custom-thumb');store.db.close();
});
test('automatic admission evicts least recently used audio atomically and leaves lyrics/artwork/playlist membership',async()=>{
  const {store,cache}=await fixture();const old=await put(store,'oldest','automatic',64,{lyrics:'[00:00]留下歌词',lyricsEdited:true});await store.setArtwork(old.id,new Blob(['cover']),new Blob(['thumb']));await store.putPlaylist({id:'playlist',name:'保留歌单',trackIds:[old.id]});await put(store,'keepnow','automatic',64,{cacheTouchedAt:10});await put(store,'manual','download',64);await store.putTrack(track());
  const result=await cache.save(id,wav(),{mode:'automatic',limit:150,protectedIds:()=>new Set(['qq-keepnow'])});assert.equal(result.updates.length,2);const row=await store.read('tracks',old.id);assert.equal(row.cached,false);assert.equal(row.lyricsEdited,true);assert.equal(row.lyrics,'[00:00]留下歌词');assert.equal(await store.read('media',old.id),undefined);assert.equal(await (await store.read('artwork',old.id)).text(),'cover');assert.deepEqual((await store.playlists())[0].trackIds,[old.id]);assert.equal((await cache.inspect()).downloadBytes,64);store.db.close();
});
test('admission that cannot fit protected audio rolls back the entire planned eviction',async()=>{
  const {store,cache}=await fixture();await put(store,'evictable','automatic',64);await put(store,'protected','automatic',64,{favorite:true});await store.putTrack(track());await assert.rejects(cache.save(id,wav(80),{mode:'automatic',limit:100}),/cache is full/i);assert.ok(await store.read('media','qq-evictable'));assert.equal(await store.read('media',id),undefined);assert.equal((await store.read('tracks',id)).cached,false);store.db.close();
});
test('promoting automatic audio to download keeps original bytes and works with automatic capacity disabled',async()=>{
  const {store,cache}=await fixture();await put(store,'001CacheOne','automatic');const result=await cache.save(id,null,{mode:'download',limit:0});assert.equal(result.saved.cacheMode,'download');assert.equal((await cache.inspect()).downloadBytes,64);assert.equal((await cache.inspect()).automaticBytes,0);assert.equal((await store.read('media',id)).size,64);store.db.close();
});
test('cancelled or failed cache transactions cannot leave audio flags or delete existing cache',async()=>{
  const {store,cache}=await fixture();await put(store,'older','automatic');await store.putTrack(track());const stop=new AbortController();stop.abort();await assert.rejects(cache.save(id,wav(),{signal:stop.signal}),error=>error.name==='AbortError');await assert.rejects(cache.save(id,wav(),{mode:'automatic',limit:64,assets:{artwork:[()=>{},new Blob(['b'])]}}));assert.equal((await store.read('tracks',id)).cached,false);assert.equal(await store.read('media',id),undefined);assert.ok(await store.read('media','qq-older'));store.db.close();
});
test('cleaning frees only allowed online audio, reports bytes, preserves local files and original content',async()=>{
  const {store,cache}=await fixture();await put(store,'automatic','automatic');await put(store,'manual','download');const local={id:'local-one',source:'local',cached:true,size:64,lyrics:'original'};await store.putTrack(local,wav());await put(store,'protected','automatic');
  const first=await cache.clean({target:0,protectedIds:()=>new Set(['qq-protected'])});assert.equal(first.freedBytes,64);assert.equal(first.blocked,true);assert.equal((await store.read('tracks','qq-manual')).cached,true);
  const second=await cache.clean({ids:['qq-manual','local-one','qq-protected'],protectedIds:()=>new Set(['qq-protected'])});assert.equal(second.freedBytes,64);assert.ok(await store.read('media','local-one'));assert.ok(await store.read('media','qq-protected'));assert.equal((await store.read('tracks','local-one')).lyrics,'original');store.db.close();
});
test('missing cache bytes are repaired without recreating deleted songs or clearing valid replacements',async()=>{
  const {store,cache}=await fixture();await store.putTrack(track('001CacheOne','automatic',64));const fixed=await cache.missing(id);assert.equal(fixed.updates[0].cached,false);await cache.save(id,wav(),{mode:'download'});assert.deepEqual((await cache.missing(id)).updates,[]);await store.remove(id);await assert.rejects(cache.save(id,wav()),/removed/i);assert.equal((await store.tracks()).length,0);store.db.close();
});
test('cache settings and ownership survive portable v5 backup; old cached audio defaults to retained downloads',async()=>{
  const {store}=await fixture();await put(store,'001CacheOne','automatic',64,{cacheSavedAt:123,cacheTouchedAt:456});const snapshot=await store.snapshot();snapshot.preferences={autoCache:true,cacheLimitMb:256,cacheKeepFavorites:false};const decoded=await readBackup((await createBackup(snapshot)).blob);assert.equal(decoded.tracks[0].cacheMode,'automatic');assert.equal(decoded.tracks[0].cacheTouchedAt,456);assert.equal(decoded.preferences.autoCache,true);assert.equal(decoded.preferences.cacheLimitMb,256);assert.equal(decoded.preferences.cacheKeepFavorites,false);assert.equal(normalizeTrack({...decoded.tracks[0],cacheMode:undefined}).cacheMode,'download');assert.equal(normalizePreferences({autoCache:true,cacheLimitMb:0}).autoCache,false);assert.equal(DEFAULTS.autoCache,false);store.db.close();
});
test('100 duplicate download clicks coalesce to one transfer, one commit and one revoked capability',async()=>{
  let fetched=0,saved=0,revoked=0;const q=queue({fetcher:async()=>{++fetched;return new Response(wav(),{headers:{'Content-Type':'audio/wav'}});},save:async(_,blob,options)=>{++saved;return {saved:track('001CacheOne',options.mode,blob.size),updates:[]};},revoke:async path=>{assert.equal(path,url);++revoked;}});const results=Array.from({length:100},()=>q.enqueue(id));assert.ok(results.every(value=>value===results[0]));await Promise.all(results);assert.equal(fetched,1);assert.equal(saved,1);assert.equal(revoked,1);assert.equal(q.rows()[0].status,'complete');assert.equal(JSON.stringify(q.rows()).includes('/api/media/'),false);
});
test('download queue stays single-transfer with twenty admissions, explicit overflow and queued cancellation',async()=>{
  let active=0,maximum=0;const q=queue({fetcher:async(_,options)=>{++active;maximum=Math.max(active,maximum);return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>{--active;reject(options.signal.reason);},{once:true}));}});const tasks=Array.from({length:20},(_,i)=>q.enqueue('qq-queue'+i).catch(error=>error));await tick();await assert.rejects(q.enqueue('qq-overflow'),/full/i);q.cancel('qq-queue19');await tasks[19];await q.clear();await Promise.all(tasks);assert.equal(maximum,1);assert.equal(q.jobs.size,0);assert.equal(q.rows().length,20);assert.ok(q.rows().every(row=>row.status==='cancelled'));
});
test('canceling active bytes aborts the body and never calls save, allowing the next job to finish',async()=>{
  let abort,commits=0,cancelled=false;const q=queue({fetcher:async(_,options)=>{if(!abort)return new Response(new ReadableStream({start(controller){abort=()=>{cancelled=true;controller.error(options.signal.reason);};options.signal.addEventListener('abort',abort,{once:true});}}),{headers:{'Content-Type':'audio/wav'}});return new Response(wav(),{headers:{'Content-Type':'audio/wav'}});},save:async(value,blob,options)=>{++commits;return {saved:track(value.slice(3),options.mode,blob.size),updates:[]};}});const first=q.enqueue(id).catch(error=>error);await tick();const next=q.enqueue('qq-nextjob');q.cancel(id);assert.equal((await first).name,'AbortError');await next;assert.equal(cancelled,true);assert.equal(commits,1);
});
test('partial, HTML, empty, forged and oversized responses are never stored',async()=>{
  let saved=0;for(const response of [new Response(wav(),{status:206,headers:{'Content-Type':'audio/wav'}}),new Response('<html>error</html>',{headers:{'Content-Type':'text/html'}}),new Response('',{headers:{'Content-Type':'audio/wav'}}),new Response('not real audio content',{headers:{'Content-Type':'audio/mpeg'}}),new Response(wav(80),{headers:{'Content-Type':'audio/wav','Content-Length':'80'}}),new Response(wav(64),{headers:{'Content-Type':'audio/wav','Content-Length':'65'}})]){const q=queue({limits:{fileBytes:64},fetcher:async()=>response,save:async()=>{++saved;}});await assert.rejects(q.enqueue(id));}assert.equal(saved,0);
});
test('unreported size and browser quota are bounded while reading; streams are canceled on excess',async()=>{
  let canceled=false;const q=queue({limits:{fileBytes:64},fetcher:async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(80));},cancel(){canceled=true;}}),{headers:{'Content-Type':'audio/wav'}})});await assert.rejects(q.enqueue(id),/exceed/i);assert.equal(canceled,true);
  const quota=queue({estimate:async()=>({quota:100,usage:70}),fetcher:async()=>new Response(wav(),{headers:{'Content-Type':'audio/wav','Content-Length':'64'}})});await assert.rejects(quota.enqueue(id),/storage|space/i);
});
test('completed transactions remain successful after a last-moment abort, and late manual intent promotes the saved auto file',async()=>{
  let commits=0,q;const delayed=queue({save:async(value,blob,options)=>{delayed.cancel(value);return {saved:track('001CacheOne','download',blob.size),updates:[]};}});await delayed.enqueue(id);assert.equal(delayed.rows()[0].status,'complete');
  q=queue({save:async(value,blob,options)=>{++commits;if(commits===1){q.enqueue(value,{mode:'download'});return {saved:track('001CacheOne','automatic',blob.size),updates:[]};}return {saved:track('001CacheOne',options.mode,64),updates:[]};}});const result=await q.enqueue(id,{mode:'automatic'});assert.equal(commits,2);assert.equal(result.saved.cacheMode,'download');
});
test('progress reports are throttled instead of repainting once per received chunk',async()=>{
  let at=0,emits=0,chunk=0;const header=new Uint8Array(await wav().arrayBuffer());const q=queue({now:()=>at,changed:()=>++emits,fetcher:async()=>new Response(new ReadableStream({pull(controller){at+=5;if(chunk===0)controller.enqueue(header);else if(chunk<=2000)controller.enqueue(new Uint8Array(16));else controller.close();++chunk;}}),{headers:{'Content-Type':'audio/wav'}})});await q.enqueue(id);assert.ok(emits>20 && emits<100,emits);
});
test('a failed capability cleanup cannot lock the next transfer',async()=>{
  const q=queue({revoke:()=>{throw new Error('offline');}});await q.enqueue(id);await q.enqueue('qq-secondjob');assert.equal(q.jobs.size,0);assert.equal(q.rows().filter(row=>row.status==='complete').length,2);
});
test('post-commit UI failures are reported as saved audio with a refresh notice, not a failed download',async()=>{
  const q=queue({committed:()=>{throw new Error('view disposed');}});await q.enqueue(id);assert.equal(q.rows()[0].status,'complete');assert.match(q.rows()[0].warning,/Audio saved/i);
});
test('malformed or oversized platform lyrics cannot corrupt cached track metadata',async()=>{
  const {store,cache}=await fixture();await store.putTrack(track());await cache.save(id,wav(),{assets:{lyrics:{text:{unexpected:true},source:'qq'}}});assert.equal(typeof (await store.read('tracks',id)).lyrics,'string');await cache.save(id,null,{assets:{lyrics:{text:'x'.repeat(200001),source:'qq'}}});assert.equal((await store.read('tracks',id)).lyrics,'');store.db.close();
});
test('a timed-out network job fails explicitly and releases its capability',async()=>{
  let deadline,revoked=0;const q=queue({setTimer:fn=>{deadline=fn;return 1;},clearTimer:()=>{},revoke:async()=>{++revoked;},fetcher:async(_,options)=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}))});const pending=q.enqueue(id);await tick();deadline();await assert.rejects(pending,/Download timed out/i);assert.equal(q.rows()[0].status,'error');assert.equal(revoked,1);
});
test('automatic cache requires stable visible playback and honors data saving, pause and prior attempts',async()=>{
  const {store}=await fixture();await store.putTrack(track());const records=new Map([[id,track()]]);let prefs={autoCache:true,cacheLimitMb:256,cacheKeepFavorites:true},visible=true,allowed=true,sequence=0;const timers=new Map();
  const manager=new MediaCache({store,record:value=>records.get(value),ensure:async value=>records.get(value),source:async()=>({url,type:'audio/wav'}),lyrics:async()=>({}),artwork:async()=>{throw new Error('暂无封面');},resize:async()=>[],preferences:()=>prefs,protectedIds:()=>new Set([id]),visible:()=>visible,networkAllowed:()=>allowed,setTimer:(fn,ms)=>{const key=++sequence;timers.set(key,{fn,ms});return key;},clearTimer:key=>timers.delete(key),fetcher:async()=>new Response(wav(),{headers:{'Content-Type':'audio/wav'}}),committed:updates=>updates.forEach(row=>records.set(row.id,row))});
  manager.playback(id,true);assert.equal([...timers.values()][0].ms,6000);manager.playback(id,false);assert.equal(timers.size,0);visible=false;manager.playback(id,true);assert.equal(timers.size,0);visible=true;allowed=false;manager.playback(id,true);assert.equal(timers.size,0);allowed=true;manager.playback(id,true);const timer=[...timers.entries()][0];timers.delete(timer[0]);timer[1].fn();await tick();while(manager.queue.jobs.size)await tick();assert.equal((await store.read('tracks',id)).cacheMode,'automatic');assert.match(manager.tasks[0].warning,/lyrics, artwork/i);assert.equal((await manager.cache.inspect()).automaticBytes,64);await manager.clear();store.db.close();
});
test('enabling data saving cancels an already active automatic transfer without canceling manual downloads',async()=>{
  const {store}=await fixture();await store.putTrack(track());let allowed=true,token=0;const timers=new Map(),signals=[];
  const manager=new MediaCache({store,record:()=>track(),ensure:async()=>track(),source:async()=>({url,type:'audio/wav'}),preferences:()=>({autoCache:true,cacheLimitMb:256}),protectedIds:()=>new Set(),networkAllowed:()=>allowed,setTimer:(fn,ms)=>{timers.set(++token,{fn,ms});return token;},clearTimer:key=>timers.delete(key),fetcher:async(_,options)=>new Promise((_,reject)=>{signals.push(options.signal);options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});})});
  manager.playback(id,true);const timer=[...timers.entries()][0];timers.delete(timer[0]);timer[1].fn();while(!signals.length)await tick();allowed=false;manager.playback(id,true);while(manager.queue.jobs.size)await tick();assert.equal(manager.tasks[0].status,'cancelled');assert.equal((await store.read('tracks',id)).cached,false);
  const manual=manager.request(id).catch(error=>error);while(signals.length<2)await tick();manager.playback(id,true);assert.equal(signals[1].aborted,false);await manager.cancel(id);await manual;await manager.clear();store.db.close();
});
test('cache refresh reconciles another tab releasing bytes without clearing local lyrics or favorites',async()=>{
  const {store,cache}=await fixture();const row=await put(store,'001CacheOne','automatic',64,{favorite:true,lyricsEdited:true,lyrics:'用户歌词'});const records=new Map([[id,row]]);
  const manager=new MediaCache({store,record:value=>records.get(value),ensure:async value=>records.get(value),preferences:()=>({cacheLimitMb:256}),protectedIds:()=>new Set(),committed:updates=>updates.forEach(update=>Object.assign(records.get(update.id),{cached:update.cached,size:update.size,cacheMode:update.cacheMode}))});
  await cache.clean({ids:[id],keepFavorites:false});await manager.refresh();assert.equal(records.get(id).cached,false);assert.equal(records.get(id).favorite,true);assert.equal(records.get(id).lyrics,'用户歌词');assert.equal(manager.view().automaticBytes,0);assert.equal('cacheRecords' in manager.view(),false);store.db.close();
});
test('cache statistics retain compact scalar records even when songs contain maximum-length edited lyrics',async()=>{
  const {store,cache}=await fixture(),lyrics='长'.repeat(200000);await store.write(['tracks'],tx=>{for(let i=0;i<32;i++){const row=track('longlyrics'+i,'download',64,{lyrics,originalLyrics:lyrics,lyricsEdited:true});tx.objectStore('tracks').put(row,row.id);}});
  const info=await cache.inspect();assert.equal(info.cacheRecords.length,32);assert.ok(JSON.stringify(info.cacheRecords).length<16000);assert.ok(info.cacheRecords.every(row=>!('lyrics'in row) && !('originalLyrics'in row)));await cache.clean({ids:['qq-longlyrics0']});assert.equal((await store.read('tracks','qq-longlyrics0')).lyrics.length,200000);store.db.close();
});
test('a newly selected song is protected even after an eviction plan was prepared',async()=>{
  const {store,cache}=await fixture();const old=await put(store,'newlyplaying','automatic');let reads=0;
  const cleaned=await cache.clean({protectedIds:()=>++reads>1?new Set([old.id]):new Set()});assert.equal(cleaned.freedBytes,0);assert.equal(cleaned.blocked,true);assert.ok(await store.read('media',old.id));
  await store.putTrack(track());reads=0;await assert.rejects(cache.save(id,wav(),{mode:'automatic',limit:64,protectedIds:()=>++reads>1?new Set([old.id]):new Set()}),/Queue changed/i);assert.ok(await store.read('media',old.id));assert.equal(await store.read('media',id),undefined);store.db.close();
});
test('retained cache rows and global download jobs cross the bridge once during a thousand clock updates',()=>{
  const sent=[],bridge=new SnapshotBridge(raw=>sent.push(JSON.parse(raw))),rows=[{id}],jobs=[{id,status:'downloading'}];for(let i=0;i<1000;i++)bridge.publish({page:'cache',viewKey:'cache|all|0',cacheItems:rows,cacheTasks:jobs,position:i});assert.equal(sent.filter(row=>'cacheItems'in row).length,1);assert.equal(sent.filter(row=>'cacheTasks'in row).length,1);
});
test('cache history normalizes filters and pagination and returns from the player to the same list',async()=>{
  const entries=[];let index=0,listener,shown;const host={location:{hash:'#settings'},addEventListener:(_,fn)=>listener=fn,history:{replaceState:state=>{entries[index]=state;},pushState:state=>{entries[++index]=state;},back:()=>queueMicrotask(()=>listener({state:entries[--index]}))}};
  const nav=new RouteHistory(host,{page:'settings'},route=>shown=route);nav.update({page:'cache',cacheFilter:'automatic',cachePage:3});nav.update({player:true});nav.close('player');await tick();assert.equal(shown.page,'cache');assert.equal(shown.cacheFilter,'automatic');assert.equal(shown.cachePage,3);nav.update({cacheFilter:'invalid',cachePage:-10});assert.equal(shown.cacheFilter,'all');assert.equal(shown.cachePage,0);
});

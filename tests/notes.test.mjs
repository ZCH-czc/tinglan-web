import test from 'node:test';import assert from 'node:assert/strict';
import {indexedDB,IDBKeyRange,IDBIndex} from 'fake-indexeddb';
import {LibraryStore} from '../web/storage.mjs';
import {NoteStore} from '../web/note-storage.mjs';
import {NOTE_LIMITS,normalizeNote,notePreview} from '../web/note-data.mjs';
import {NotePages,NoteEditor,NoteChanges} from '../web/note-pages.mjs';
import {createBackup,readBackup,crc32Bytes} from '../web/backup.mjs';
import {SnapshotBridge} from '../web/snapshot-bridge.mjs';
import {RouteHistory} from '../web/navigation.mjs';
globalThis.indexedDB=indexedDB;globalThis.IDBKeyRange=IDBKeyRange;
const note=(id='local-one',at=100)=>({songId:id,title:'海风',artists:'听岚',category:'Thoughts',content:'这一刻的感受',createdAt:10,updatedAt:at});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
async function using(run){await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('tinglan-web-library');r.onsuccess=resolve;r.onerror=()=>reject(r.error);});const library=new LibraryStore();await library.open();try{return await run(library,new NoteStore(library));}finally{library.db.close();}}
async function seed(library,values){await library.write(['notes'],tx=>{for(const value of values)tx.objectStore('notes').put({...normalizeNote(value),sortTime:-value.updatedAt,revision:'fixture-'+value.songId},value.songId);});}
async function changeManifest(blob,change){const prefix=new Uint8Array(await blob.slice(0,16).arrayBuffer()),view=new DataView(prefix.buffer),length=view.getUint32(8,true),value=JSON.parse(await blob.slice(16,16+length).text());change(value);const header=new TextEncoder().encode(JSON.stringify(value));view.setUint32(8,header.length,true);view.setUint32(12,crc32Bytes(header),true);return new Blob([prefix,header,blob.slice(16+length)]);}
const emptyBackup=()=>({tracks:[],media:[],artwork:[],playlists:[],preferences:{},notes:[]});

test('note fields follow native limits, normalize categories and exclude private/internal backup fields',()=>{
  const row=normalizeNote({...note(),category:'  ',content:'  hello  ',revision:'private',sortTime:-100});assert.equal(row.category,'Thoughts');assert.equal(row.content,'hello');assert.equal(row.revision,undefined);assert.equal(row.sortTime,undefined);
  for(const patch of [{songId:'../../1'},{content:' '},{content:'x'.repeat(12001)},{category:'x'.repeat(33)},{updatedAt:9},{updatedAt:Infinity}])assert.throws(()=>normalizeNote({...note(),...patch}));
  assert.equal(notePreview({...note(),content:'x'.repeat(12000)}).preview.length,320);
});

test('indexed pages preserve native date-descending/id-ascending order, category and Unicode search',async()=>using(async(library,store)=>{
  await seed(library,Array.from({length:1000},(_,i)=>({...note('local-'+String(i).padStart(4,'0'),i<60?900:800),category:i%2?'现场':'Thoughts',content:i%3?'普通笔记':'Ｆｕｌｌｗｉｄｔｈ LOVE'})));
  const page=await store.page({page:1});assert.equal(page.count,1000);assert.equal(page.items.length,24);assert.equal(page.items[0].songId,'local-0024');assert.equal(page.items.at(-1).songId,'local-0047');assert.deepEqual(page.categories,['Thoughts','现场']);
  const filtered=await store.page({category:'现场',query:'fullwidth love',page:999});assert.equal(filtered.count,167);assert.equal(filtered.page,6);assert.equal(filtered.items.length,23);assert.ok(filtered.items.every(row=>row.category==='现场' && row.content.includes('LOVE')));
  const authors=await store.page({query:'听岚'});assert.equal(authors.count,1000);assert.equal((await store.page({query:'missing'})).pages,1);
}));

test('optimistic note writes and deletes reject a stale tab without losing newer text',async()=>using(async(library,store)=>{
  await store.save(note());const first=await store.read('local-one');await store.save({...first,content:'新编辑',updatedAt:101},{expectedRevision:first.revision});
  await assert.rejects(store.save({...first,content:'旧标签页',updatedAt:102},{expectedRevision:first.revision}),e=>e.code==='note-conflict');await assert.rejects(store.remove(first.songId,{expectedRevision:first.revision}),e=>e.code==='note-conflict');
  const latest=await store.read(first.songId);assert.equal(latest.content,'新编辑');await store.remove(latest.songId,{expectedRevision:latest.revision});assert.equal(await store.count(),0);
}));

test('removing music preserves readable notes and does not recreate audio or playlist records',async()=>using(async(library,store)=>{
  await library.putTrack({id:'local-one',title:'海风',artist:'听岚',size:4},new Blob(['WAVE']));await store.save(note());await library.remove('local-one');
  assert.equal((await library.tracks()).length,0);assert.equal(await library.read('media','local-one'),undefined);assert.equal((await store.page({})).items[0].content,'这一刻的感受');assert.equal((await library.snapshot()).notes.length,1);
}));

test('cancelled indexed reads and transactions reject explicitly and roll back note writes',async()=>using(async(library,store)=>{
  await seed(library,Array.from({length:200},(_,i)=>note('local-'+i)));const cancelled=new AbortController(),read=store.page({}, {signal:cancelled.signal});cancelled.abort();await assert.rejects(read,e=>e.name==='AbortError');
  const controller=new AbortController(),write=store.save(note('local-new'),{signal:controller.signal});controller.abort();await assert.rejects(write,e=>e.name==='AbortError');assert.equal(await store.read('local-new'),null);
}));

test('10000-note capacity is atomic and editing an existing note still works at the limit',async()=>using(async(library,store)=>{
  await seed(library,Array.from({length:10000},(_,i)=>note('local-'+i)));
  await assert.rejects(store.save(note('local-overflow')),/10000/);assert.equal(await store.count(),10000);const old=await store.read('local-0');await store.save({...old,content:'保留的编辑',updatedAt:200},{expectedRevision:old.revision});assert.equal((await store.read('local-0')).content,'保留的编辑');
}));

test('backup v3 retains orphan notes and CRC checks them before any restore can run',async()=>{
  const snapshot=emptyBackup();snapshot.notes=[note('bili-BV1xx411c7mD_123')];const exported=await createBackup(snapshot);assert.equal(exported.notes,1);const restored=await readBackup(exported.blob);assert.deepEqual(restored.notes,snapshot.notes);assert.equal(restored.tracks.length,0);
  const bytes=new Uint8Array(await exported.blob.arrayBuffer());bytes[bytes.length-1]^=1;await assert.rejects(readBackup(new Blob([bytes])),/verif|validat/i);
  await assert.rejects(readBackup(await changeManifest(exported.blob,value=>{value.noteIds=[];})),/unknown/i);
  await assert.rejects(readBackup(await changeManifest(exported.blob,value=>{value.entries=[];})),/length|Missing|missing/i);
});

test('large note content uses bounded payloads instead of expanding the backup header',async()=>{
  const snapshot=emptyBackup();snapshot.notes=Array.from({length:512},(_,i)=>({...note('local-'+i),content:'岚'.repeat(NOTE_LIMITS.content)}));
  const exported=await createBackup(snapshot),prefix=new DataView(await exported.blob.slice(0,16).arrayBuffer());assert.ok(exported.blob.size>16*1024*1024);assert.ok(prefix.getUint32(8,true)<512*1024);
  const read=await readBackup(exported.blob);assert.equal(read.notes.length,512);assert.equal(read.notes.at(-1).content.length,12000);
});

test('legacy backups leave existing notes intact; merge preserves newer edits and rolls back all stores together',async()=>using(async(library,store)=>{
  await store.save(note('local-one',500));const snapshot=emptyBackup(),exported=await createBackup(snapshot),legacy=await readBackup(await changeManifest(exported.blob,value=>{value.version=2;delete value.noteIds;}));await library.mergeBackup(legacy,{});assert.equal((await store.read('local-one')).updatedAt,500);
  snapshot.notes=[note('local-one',100),note('local-two',200)];await library.mergeBackup(snapshot,{});assert.equal((await store.read('local-one')).updatedAt,500);assert.equal((await store.read('local-two')).updatedAt,200);
  snapshot.notes=[{...note('local-one',700),content:'较新的备份'}];await library.mergeBackup(snapshot,{});assert.equal((await store.read('local-one')).content,'较新的备份');
  const broken={...emptyBackup(),tracks:[{id:'local-bad',title:'rollback'}],media:[{id:'local-bad',blob:()=>{}}],notes:[note('local-rollback')]};await assert.rejects(library.mergeBackup(broken,{}));assert.equal(await store.read('local-rollback'),null);assert.equal(await library.read('tracks','local-bad'),undefined);
}));

test('editor retains native metadata snapshots, duplicates save once and rejects a stale dialog token',async()=>using(async(library,store)=>{
  let commits=0;const editor=new NoteEditor(store,()=>{},{now:()=>100,committed:()=>++commits});await editor.open('local-one',{title:'海风',artist:'听岚'});const token=editor.state.token;
  const results=await Promise.all(Array.from({length:100},()=>editor.save({token,category:'现场',content:'新笔记'})));assert.ok(results.every(Boolean));assert.equal(commits,1);assert.equal((await store.read('local-one')).category,'现场');
  editor.close();await editor.open('local-two',{title:'另一首',artist:'作者'});assert.equal(await editor.save({token,category:'Thoughts',content:'错目标'}),false);assert.equal(await store.read('local-two'),null);editor.close();
}));

test('late editor reads and cancelled writes cannot publish into a new note dialog',async()=>{
  const reads=[],write=deferred();let signal,commits=0;const editor=new NoteEditor({read:()=>{const d=deferred();reads.push(d);return d.promise;},save:async(_,options)=>{signal=options.signal;await write.promise;options.signal.throwIfAborted();}},()=>{},{committed:()=>++commits});
  const old=editor.open('local-old',{title:'旧歌',artist:'作者'}),current=editor.open('local-current',{title:'新歌',artist:'作者'});reads[1].resolve(null);await current;reads[0].resolve(note('local-old'));await old;assert.equal(editor.state.songId,'local-current');
  const saving=editor.save({token:editor.state.token,content:'不会提交',category:'Thoughts'});editor.close();assert.equal(signal.aborted,true);write.resolve();assert.equal(await saving,false);assert.equal(editor.state.token,'');assert.equal(commits,0);
});

test('edited conflicts stay visible and reload obtains the latest revision before saving again',async()=>using(async(library,store)=>{
  await store.save(note());const first=new NoteEditor(store,()=>{},{now:()=>200}),second=new NoteEditor(store,()=>{},{now:()=>300});await first.open('local-one');await second.open('local-one');
  assert.equal(await first.save({token:first.state.token,content:'第一处',category:'Thoughts'}),true);assert.equal(await second.save({token:second.state.token,content:'第二处',category:'Thoughts'}),false);assert.equal(second.state.conflict,true);assert.match(second.state.error,/elsewhere/i);
  await second.open('local-one');assert.equal(second.state.content,'第一处');assert.equal(await second.save({token:second.state.token,content:'重新编辑',category:'Thoughts'}),true);first.close();second.close();
}));

test('notes page cache coalesces rapid reads, rejects obsolete filters and reuses accepted pages',async()=>{
  const jobs=[];let shown;const pages=new NotePages((request,options)=>{const d=deferred();jobs.push({...d,request,signal:options.signal});return d.promise;},state=>shown=state);
  const first=Array.from({length:100},()=>pages.select({query:'海风'}));assert.equal(jobs.length,1);jobs[0].resolve({items:[note()],categories:['Thoughts'],count:1,page:0,pages:1});await Promise.all(first);const categories=shown.categories;await pages.select({query:'海风'});assert.equal(jobs.length,1);
  const old=pages.select({query:'旧'}),current=pages.select({query:'新'});assert.equal(jobs[1].signal.aborted,true);assert.equal(pages.forRequest({query:'pending'}).categories,categories);jobs[2].resolve({items:[note('local-new')],categories:['Thoughts'],count:1,page:0,pages:1});await current;jobs[1].resolve({items:[note('local-old')],categories:[],count:1,page:0,pages:1});await old;assert.equal(shown.items[0].songId,'local-new');assert.equal(shown.categories,categories);
  const refresh=pages.select({query:'新'},{force:true});jobs[3].reject(new Error('storage unavailable'));await refresh;assert.equal(shown.items[0].songId,'local-new');assert.match(shown.warning,/storage/);
});

test('clamped pages are cached at the actual page and invalidation only refreshes on a new selection',async()=>{
  let calls=0;const pages=new NotePages(async()=>{++calls;return {items:[note()],categories:['Thoughts'],count:1,page:0,pages:1};},()=>{},{limit:2});await pages.select({page:416});assert.equal(pages.current.request.page,0);await pages.select({page:0});assert.equal(calls,1);
  pages.invalidate();await pages.select({page:0});assert.equal(calls,2);for(const query of ['a','b','c'])await pages.select({query});assert.equal(pages.cache.size,2);
});

test('note preview collections and long editor text cross Wasm once in 1000 playback updates',()=>{
  const messages=[],bridge=new SnapshotBridge(raw=>messages.push(JSON.parse(raw))),noteItems=Array.from({length:24},(_,i)=>notePreview({...note('local-'+i),content:'x'.repeat(12000)})),noteCategories=['Thoughts'],noteEditor={token:'fixture',content:'x'.repeat(12000)};
  for(let i=0;i<1000;i++)bridge.publish({viewKey:'notes|all|0',noteItems,noteCategories,noteEditor,status:i%2?'playing':'paused'});assert.equal(messages[0].noteItems[0].preview.length,320);assert.ok(messages.slice(1).every(row=>!('noteItems' in row) && !('noteEditor' in row) && !('noteCategories' in row)));assert.ok([...bridge.pages.values()].every(value=>!value.has('noteEditor')));
});

test('notes filters and page return through playback history without altering the prior library tab',async()=>{
  const entries=[];let index=0,listener,shown;const host={location:{hash:'#library'},addEventListener:(_,f)=>listener=f};host.history={replaceState:s=>entries[index]=s,pushState:s=>{entries.splice(++index);entries[index]=s;},back:()=>{if(index>0){--index;queueMicrotask(()=>listener({state:entries[index]}));}}};
  const nav=new RouteHistory(host,{page:'library',tab:'favorites'},route=>shown=route);nav.update({page:'notes',notesQuery:'海风',notesCategory:'现场',notesPage:3});nav.update({player:true});nav.close('player');await Promise.resolve();assert.equal(shown.notesPage,3);assert.equal(shown.notesQuery,'海风');nav.back();await Promise.resolve();assert.equal(shown.tab,'favorites');
});

test('cross-tab changes coalesce 100 messages without transmitting note content and dispose late timers',()=>{
  const timers=new Map(),sent=[];let next=0,changes=0,channel;
  const updates=new NoteChanges(()=>++changes,{factory:()=>channel={postMessage:value=>sent.push(value),close:()=>{}},schedule:fn=>{timers.set(++next,fn);return next;},cancel:id=>timers.delete(id)});updates.open();updates.notify();assert.deepEqual(sent,[{kind:'notes-changed'}]);
  channel.onmessage({data:{kind:'foreign'}});assert.equal(timers.size,0);for(let i=0;i<100;i++)channel.onmessage({data:{kind:'notes-changed'}});assert.equal(timers.size,1);[...timers.values()][0]();assert.equal(changes,1);
  channel.onmessage({data:{kind:'notes-changed'}});const late=[...timers.values()].at(-1);updates.close();late();assert.equal(changes,1);
  const blocked=new NoteChanges(()=>assert.fail('unsupported channel'),{factory:()=>{throw new Error('not available')}});blocked.open();blocked.notify();blocked.close();
});

test('wrong stored song identity is rejected before an editor can remove another note',async()=>using(async(library,store)=>{
  await seed(library,[note('local-a'),note('local-b')]);await library.write(['notes'],tx=>tx.objectStore('notes').put({...note('local-b'),sortTime:-100,revision:'fixture'},'local-a'));
  await assert.rejects(store.read('local-a'),/mismatch|do not match|does not match/i);await assert.rejects(store.page({}),/mismatch|do not match|does not match/i);assert.equal((await store.read('local-b')).content,'这一刻的感受');
}));

test('post-commit refresh failure cannot report a confirmed note save as failed',async()=>using(async(library,store)=>{
  const editor=new NoteEditor(store,()=>{},{committed:()=>{throw new Error('cache unavailable')}});await editor.open('local-one',{title:'海风',artist:'听岚'});assert.equal(await editor.save({token:editor.state.token,content:'确已保存',category:'Thoughts'}),true);assert.equal((await store.read('local-one')).content,'确已保存');assert.equal(editor.state.error,'');editor.close();
}));

test('plain/category paging skips stored bodies outside a 24-row window even on later pages',async()=>using(async(library,store)=>{
  await seed(library,Array.from({length:1000},(_,i)=>({...note('local-'+String(i).padStart(4,'0'),2000-i),category:i%2?'现场':'Thoughts'})));
  const original=IDBIndex.prototype.openCursor;let rows=0;
  IDBIndex.prototype.openCursor=function(...args){const request=original.apply(this,args);request.addEventListener('success',()=>{if(request.result)++rows;});return request;};
  try{const page=await store.page({page:20});assert.equal(page.items[0].songId,'local-0480');assert.equal(page.items.length,24);assert.ok(rows<=25);rows=0;const category=await store.page({category:'现场',page:20});assert.equal(category.items.length,20);assert.equal(category.page,20);assert.ok(rows<=21);}finally{IDBIndex.prototype.openCursor=original;}
}));

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const module = await import('../build/dist/engine/tinglan-web-core.mjs');
const engine = module.engineVersion ? module : module.default;
const populate = () => {
  engine.resetEngine();
  for (const id of ['a', 'b', 'c']) assert.equal(engine.upsertTrack(id, `标题-${id}`, '听岚', 60_000, false), true);
};
test('metadata-only playlist imports do not alter the live Wasm queue, song or position',()=>{
  engine.resetEngine();assert.equal(engine.upsertMetadata('new','歌单歌曲','歌手',60000,false),true);assert.equal(engine.currentId(),'');assert.deepEqual(JSON.parse(engine.queueIdsJson()),[]);
  engine.upsertTrack('current','当前歌曲','歌手',120000,true);engine.setPosition(20000);engine.upsertMetadata('extra','更多歌曲','歌手',60000,false);assert.equal(engine.currentId(),'current');assert.equal(engine.positionMs(),20000);assert.deepEqual(JSON.parse(engine.queueIdsJson()),['current']);
});

test('production Wasm keeps a playing Bilibili CID and its position when accepting the multipart queue',()=>{
  engine.resetEngine();
  const first='bili-BV1xx411c7mD',current=first+'_cid_222',third=first+'_cid_333';
  engine.upsertTrack(current,'P2 · 当前分段','音乐人',60000,true);engine.setPosition(15000);
  for(const id of [first,current,third])assert.equal(engine.upsertMetadata(id,id,'音乐人',60000,id===current),true);
  assert.equal(engine.setQueueIds([first,current,third].join('\n')),true);
  assert.equal(engine.currentId(),current);assert.equal(engine.positionMs(),15000);assert.equal(engine.currentQueueIndex(),1);
  assert.equal(JSON.parse(engine.currentTrackJson()).favorite,true);assert.equal(engine.nextTrack(true),third);
});
test('transient metadata release protects saved entries, playback queue and saved playlist members in Wasm',()=>{
  engine.resetEngine();for(const id of ['saved','current','playlist','old']){engine.upsertMetadata(id,id,'歌手',60000,false);engine.setLyrics(id,'[00:01]保留歌词');}
  engine.setQueueIds('current');engine.setPosition(5000);engine.upsertPlaylist('p','歌单','playlist',1);assert.equal(engine.releaseUnretained('saved'),1);
  assert.deepEqual(JSON.parse(engine.libraryJson('',false)).map(row=>row.id),['saved','current','playlist']);assert.equal(engine.currentId(),'current');assert.equal(engine.positionMs(),5000);assert.equal(JSON.parse(engine.lyricsJson('playlist')).lines[0].text,'保留歌词');
});

test('production artifact is an actual Wasm binary and exported Kotlin runs', async () => {
  const bytes = await readFile(new URL('../build/dist/engine/tinglan-web-core.wasm', import.meta.url));
  assert.deepEqual(Array.from(bytes.subarray(0, 4)), [0, 97, 115, 109]);
  assert.ok(WebAssembly.validate(bytes)); assert.equal(engine.engineVersion(), '0.31.1');
});
test('Wasm queue survives 10000 rapid next/previous pairs', () => {
  populate();
  for (let i = 0; i < 10_000; i++) { engine.nextTrack(false); engine.previousTrack(); }
  assert.equal(JSON.parse(engine.queueJson()).length, 3); assert.equal(engine.currentId(), 'a');
});
test('queue removal and reordering keep library songs, favourites, lyrics and playlists intact',()=>{
  populate();engine.setLyrics('b','[00:01]保留歌词');engine.toggleFavorite('b');engine.upsertPlaylist('p','保留歌单','b',1);
  assert.equal(engine.moveTrack('b',0),true);assert.equal(JSON.parse(engine.queueJson())[0].id,'b');engine.selectTrack('b');
  assert.equal(engine.removeQueuedTrack('b'),true);assert.equal(engine.currentId(),'a');
  assert.equal(JSON.parse(engine.libraryJson('',false)).length,3);assert.equal(JSON.parse(engine.lyricsJson('b')).lines[0].text,'保留歌词');
  assert.deepEqual(JSON.parse(engine.playlistJson('p')).trackIds,['b']);engine.clearQueue();assert.equal(engine.currentId(),'');assert.deepEqual(JSON.parse(engine.queueJson()),[]);
});
test('large queues expose a bounded window around the current song without changing playback order',()=>{
  engine.resetEngine();for(let i=0;i<10000;i++)engine.upsertTrack(`song-${i}`,`歌 ${i}`,'听岚',60000,false);
  engine.selectTrack('song-9500');assert.equal(engine.currentQueueIndex(),9500);assert.equal(engine.queueSize(),10000);
  const window=JSON.parse(engine.queueWindowJson(9380,240));assert.equal(window.length,240);assert.equal(window[120].id,'song-9500');
  assert.equal(JSON.parse(engine.queueWindowJson(-1,10000)).length,500);assert.equal(engine.currentId(),'song-9500');
  assert.equal(JSON.parse(engine.queueIdsJson()).length,10000);assert.equal(engine.nextTrack(false),'song-9501');
});
test('Wasm lyric parser handles Unicode, translation, offsets, seek and binary search', () => {
  populate();
  assert.equal(engine.setLyrics('a', '[offset:-500]\n[00:00.50]开头🎵\n[00:02]こんにちは\n[00:02]你好\n[01:40]结尾'), true);
  const lyrics = JSON.parse(engine.lyricsJson('a'));
  assert.equal(lyrics.lines[0].timeMs, 0); assert.equal(lyrics.lines[1].text, 'こんにちは\n你好');
  assert.equal(engine.activeLyric('a', 1499), 0); assert.equal(engine.activeLyric('a', 1500), 1);
  assert.equal(engine.lyricSeekMs('a', 2), 60_000); assert.equal(engine.lyricSeekMs('a', -1), -1);
  assert.equal(engine.lyricRefreshDelay('a', 1250, 1), 250);
});
test('JSON bridge preserves untrusted strings without evaluating them', () => {
  engine.resetEngine();
  const title = '<img src=x onerror=alert(1)>"\n\\\u0000';
  engine.upsertTrack('x', title, '艺术家', 5, false);
  assert.equal(JSON.parse(engine.libraryJson('', false))[0].title, title);
});
test('empty, deleted, repeat-one and malformed positions are handled across JS/Wasm', () => {
  populate(); engine.setRepeatMode('ONE');
  assert.equal(engine.nextTrack(true), 'a'); assert.equal(engine.nextTrack(false), 'b');
  assert.equal(engine.setPosition(NaN), 0); assert.equal(engine.setPosition(Infinity), 0);
  for (const id of ['a', 'b', 'c']) engine.removeTrack(id);
  assert.equal(engine.currentId(), ''); assert.equal(engine.nextTrack(true), ''); assert.equal(engine.previousTrack(), '');
  assert.equal(engine.selectTrack('missing'), false);
});
test('shared Android waveform policy runs in Wasm with finite values', () => {
  for (const phase of [0, .25, .5, 1, NaN]) assert.ok(Number.isFinite(engine.waveform(phase, 0)));
  assert.ok(Math.abs(engine.waveform(0, 2) - engine.waveform(1, 2)) < .00001);
});

test('actual Wasm playlist bridge preserves membership, isolates queue and cleans deleted songs', () => {
  populate(); assert.ok(engine.upsertPlaylist('p', '夜航🎵', 'b\na', Date.now()));
  assert.ok(engine.addPlaylistSong('p', 'c')); assert.ok(engine.addPlaylistSong('p', 'c'));
  assert.deepEqual(JSON.parse(engine.playlistJson('p')).trackIds, ['b', 'a', 'c']);
  assert.ok(engine.setQueueIds('b\na')); engine.selectTrack('b');
  assert.equal(engine.nextTrack(true), 'a'); assert.equal(engine.nextTrack(true), '');
  engine.removeTrack('a'); assert.deepEqual(JSON.parse(engine.playlistJson('p')).trackIds, ['b', 'c']);
  assert.equal(engine.setQueueIds('b\nmissing'), false);
  engine.resetEngine(); assert.deepEqual(JSON.parse(engine.playlistsJson()), []);
});

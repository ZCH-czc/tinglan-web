import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, readBackup, crc32Bytes, crc32Blob } from '../web/backup.mjs';
import { normalizePreferences } from '../web/library-data.mjs';

const snapshot = () => {
  const audio = new Blob(['original audio bytes'], { type: 'audio/wav' });
  const picture = new Blob(['original artwork bytes'], { type: 'image/webp' });
  return {
    tracks: [{ id: 'local-test', title: '海风🎵', artist: '听岚', filename: 'song.wav', size: audio.size, durationMs: 12000, favorite: true, lyrics: '[00:03]你好', hasArtwork: true }],
    media: [{ id: 'local-test', blob: audio }], artwork: [{ key: 'local-test', blob: picture }, { key: 'local-test:thumb', blob: picture }],
    playlists: [{ id: 'playlist-test', name: '夜间航线', trackIds: ['local-test'], createdAt: 42 }],
    preferences: { theme: 'dark', volume: 0, currentId: 'local-test', position: 3000, queue: ['local-test'], repeat: 'ONE', autoOpen: false },
  };
};
async function alterManifest(blob, change) {
  const prefix = new Uint8Array(await blob.slice(0, 16).arrayBuffer()), view = new DataView(prefix.buffer);
  const oldLength = view.getUint32(8, true), original = JSON.parse(await blob.slice(16, 16 + oldLength).text());
  change(original); const header = new TextEncoder().encode(JSON.stringify(original)); view.setUint32(8, header.length, true); view.setUint32(12, crc32Bytes(header), true);
  return new Blob([prefix, header, blob.slice(16 + oldLength)]);
}
test('CRC32 agrees with the standard check vector and works across stream chunks', async () => {
  assert.equal(crc32Bytes(new TextEncoder().encode('123456789')), 0xcbf43926);
  const data = new Uint8Array(300000).map((_, index) => index % 255);
  assert.equal(await crc32Blob(new Blob([data])), crc32Bytes(data));
});
test('portable backup restores actual audio, covers, lyrics, favourite, playlist and paused position', async () => {
  const input = snapshot(); const exported = await createBackup(input); const restored = await readBackup(exported.blob);
  assert.equal(restored.tracks[0].title, '海风🎵'); assert.equal(restored.tracks[0].favorite, true); assert.equal(restored.tracks[0].lyrics, '[00:03]你好');
  assert.equal(await restored.media[0].blob.text(), await input.media[0].blob.text());
  assert.equal(await restored.artwork[0].blob.text(), await input.artwork[0].blob.text());
  assert.deepEqual(restored.playlists[0].trackIds, ['local-test']); assert.equal(restored.preferences.position, 3000); assert.equal(restored.preferences.volume, 0);
});
test('segmented Bilibili metadata, edited subtitles, queue and paused position survive a complete backup',async()=>{
  const id='bili-BV1xx411c7mD_cid_222';
  const input={tracks:[{id,remoteId:'BV1xx411c7mD_cid_222',source:'bili',size:0,title:'P2 · 山间',favorite:true,lyrics:'[00:03]已修改字幕',originalLyrics:'[00:03]原字幕',lyricsEdited:true}],media:[],artwork:[],playlists:[{id:'parts',name:'分 P 歌单',trackIds:[id],createdAt:0}],preferences:{currentId:id,queue:[id],position:3000}};
  const exported=await createBackup(input),restored=await readBackup(exported.blob);
  assert.equal(restored.tracks[0].remoteId,input.tracks[0].remoteId);assert.equal(restored.tracks[0].lyricsEdited,true);assert.equal(restored.tracks[0].originalLyrics,input.tracks[0].originalLyrics);assert.equal(restored.tracks[0].favorite,true);
  assert.deepEqual(restored.preferences.queue,[id]);assert.equal(restored.preferences.position,3000);assert.equal(restored.playlists[0].trackIds[0],id);
});
test('payload corruption, truncation and trailing data are rejected before storage mutation', async () => {
  const { blob } = await createBackup(snapshot());
  const bytes = new Uint8Array(await blob.arrayBuffer()); bytes[bytes.length - 1] ^= 1;
  await assert.rejects(readBackup(new Blob([bytes])), /verification failed|validation failed/i);
  await assert.rejects(readBackup(blob.slice(0, blob.size - 1)), /Incomplete|incomplete/i);
  await assert.rejects(readBackup(new Blob([blob, 'extra'])), /length/i);
});
test('header corruption and oversized declared headers fail before allocating large buffers', async () => {
  const { blob } = await createBackup(snapshot());
  const bytes = new Uint8Array(await blob.arrayBuffer()); bytes[18] ^= 1;
  await assert.rejects(readBackup(new Blob([bytes])), /verification failed|validation failed/i);
  new DataView(bytes.buffer).setUint32(8, 0xffffffff, true);
  await assert.rejects(readBackup(new Blob([bytes])), /metadata is damaged/i);
});
test('unknown versions, duplicate file indexes and invalid playlist references fail even with valid checksums', async () => {
  const { blob } = await createBackup(snapshot());
  await assert.rejects(readBackup(await alterManifest(blob, value => { value.version = 200; })), /version/i);
  await assert.rejects(readBackup(await alterManifest(blob, value => { value.entries[1] = value.entries[0]; })), /Duplicate.*index/i);
  await assert.rejects(readBackup(await alterManifest(blob, value => { value.playlists[0].trackIds = ['missing']; })), /Missing|missing/i);
});
test('incomplete source snapshot does not produce a deceptively successful backup', async () => {
  const input = snapshot(); input.media = [];
  await assert.rejects(createBackup(input), /Missing audio file/i);
});
test('empty libraries with empty playlists are portable without any audio payload', async () => {
  const input = { tracks: [], media: [], artwork: [], playlists: [{ id: 'playlist-empty', name: '夜晚', trackIds: [], createdAt: 0 }], preferences: {} };
  const { blob } = await createBackup(input); const restored = await readBackup(blob);
  assert.equal(restored.tracks.length, 0); assert.equal(restored.playlists.length, 1);
});
test('preferences only restore known fields and sanitise malformed values', () => {
  const restored = normalizePreferences({ volume: NaN, theme: 'evil', queue: ['local-test', 'local-test', 'missing'], currentId: 'missing', credentials: 'must not survive', autoOpen: 'true' }, new Set(['local-test']));
  assert.equal(restored.volume, 80); assert.equal(restored.theme, 'system'); assert.equal(restored.currentId, '');
  assert.equal(restored.autoOpen, true); assert.deepEqual(restored.queue, ['local-test','local-test']); assert.equal(restored.queueIndex,-1); assert.equal('credentials' in restored, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMetadata } from '../web/metadata-parse.mjs';
import { taggedWav, taggedMp3, taggedFlac, taggedM4a, originalCover } from './media-fixtures.mjs';

test('valid silent WAV exposes embedded Unicode title, artwork, lyrics and duration', async () => {
  const metadata = await extractMetadata(new File([taggedWav()], 'unrelated-name.wav', { type: 'audio/wav' }));
  assert.equal(metadata.title, '海风来信'); assert.equal(metadata.artist, '听岚测试'); assert.equal(metadata.album, '夜间航线');
  assert.equal(metadata.durationMs, 12000); assert.match(metadata.lyrics, /海风经过窗边/);
  assert.equal(metadata.cover.type, 'image/png'); assert.deepEqual(Buffer.from(await metadata.cover.arrayBuffer()), originalCover());
});
test('ID3v2.4 tags in MPEG files preserve UTF-8 and front cover', async () => {
  const metadata = await extractMetadata(new Blob([taggedMp3()], { type: 'audio/mpeg' }));
  assert.equal(metadata.title, '中文歌名🎵'); assert.equal(metadata.artist, '多语言艺术家'); assert.ok(metadata.cover);
});
test('FLAC reads Vorbis comments and STREAMINFO duration without scanning audio', async () => {
  const metadata = await extractMetadata(new Blob([taggedFlac()], { type: 'audio/flac' }));
  assert.equal(metadata.title, 'FLAC title'); assert.equal(metadata.album, 'Quiet Hours'); assert.equal(metadata.durationMs, 12000);
});
test('M4A reads iTunes metadata atom fields', async () => {
  const metadata = await extractMetadata(new Blob([taggedM4a()], { type: 'audio/mp4' }));
  assert.equal(metadata.title, 'M4A title'); assert.equal(metadata.artist, 'Tinglan'); assert.equal(metadata.album, 'Quiet Hours');
});
test('malformed media fails safely for the caller to keep filename fallback', async () => {
  await assert.rejects(extractMetadata(new Blob(['not a media file'])));
});

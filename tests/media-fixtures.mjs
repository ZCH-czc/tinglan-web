import { deflateSync } from 'node:zlib';
import { crc32Bytes } from '../web/backup.mjs';

const syncSize = size => Buffer.from([(size >>> 21) & 127, (size >>> 14) & 127, (size >>> 7) & 127, size & 127]);
function frame(id, data) { return Buffer.concat([Buffer.from(id), syncSize(data.length), Buffer.alloc(2), data]); }
function pngChunk(name, bytes) {
  const type = Buffer.from(name), length = Buffer.alloc(4), crc = Buffer.alloc(4); length.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32Bytes(Buffer.concat([type, bytes])));
  return Buffer.concat([length, type, bytes, crc]);
}
export function originalCover() {
  const header = Buffer.alloc(13); header.writeUInt32BE(32, 0); header.writeUInt32BE(32, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(32 * (1 + 32 * 3));
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const offset = y * 97 + 1 + x * 3; pixels[offset] = 30 + x * 2; pixels[offset + 1] = 110 + y * 3; pixels[offset + 2] = 115 + x + y;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))]);
}
function tags({ title, artist, album, cover, lyrics }) {
  const frames = [];
  for (const [id, text] of [['TIT2', title], ['TPE1', artist], ['TALB', album]]) if (text) frames.push(frame(id, Buffer.concat([Buffer.from([3]), Buffer.from(text)])));
  if (cover) frames.push(frame('APIC', Buffer.concat([Buffer.from([3]), Buffer.from('image/png\0'), Buffer.from([3, 0]), cover])));
  if (lyrics) frames.push(frame('USLT', Buffer.concat([Buffer.from([3]), Buffer.from('eng\0'), Buffer.from(lyrics)])));
  const body = Buffer.concat(frames); return Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0]), syncSize(body.length), body]);
}
function riffChunk(name, data) {
  const length = Buffer.alloc(4); length.writeUInt32LE(data.length);
  return Buffer.concat([Buffer.from(name), length, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}
export function taggedWav({ title = '海风来信', artist = '听岚测试', album = '夜间航线', cover = originalCover(), lyrics = '[00:00.00]海风经过窗边\n[00:03.00]把这一刻留给音乐', seconds = 12 } = {}) {
  const format = Buffer.alloc(16); format.writeUInt16LE(1); format.writeUInt16LE(1, 2); format.writeUInt32LE(8000, 4); format.writeUInt32LE(16000, 8); format.writeUInt16LE(2, 12); format.writeUInt16LE(16, 14);
  const chunks = Buffer.concat([riffChunk('fmt ', format), riffChunk('id3 ', tags({ title, artist, album, cover, lyrics })), riffChunk('data', Buffer.alloc(16000 * seconds))]);
  const size = Buffer.alloc(4); size.writeUInt32LE(chunks.length + 4);
  return Buffer.concat([Buffer.from('RIFF'), size, Buffer.from('WAVE'), chunks]);
}
export function taggedMp3() { return Buffer.concat([tags({ title: '中文歌名🎵', artist: '多语言艺术家', album: '试验专辑', cover: originalCover() }), Buffer.from([0xff, 0xfb, 0x90, 0]), Buffer.alloc(413)]); }
export function taggedFlac() {
  const stream = Buffer.alloc(34); stream.writeUInt16BE(4096, 0); stream.writeUInt16BE(4096, 2);
  stream.writeBigUInt64BE((8000n << 44n) | (15n << 36n) | 96000n, 10);
  const vendor = Buffer.from('Tinglan tests'), comments = ['TITLE=FLAC title', 'ARTIST=Tinglan', 'ALBUM=Quiet Hours'];
  const number = value => { const out = Buffer.alloc(4); out.writeUInt32LE(value); return out; };
  const comment = Buffer.concat([number(vendor.length), vendor, number(comments.length), ...comments.flatMap(value => [number(Buffer.byteLength(value)), Buffer.from(value)])]);
  const block = (type, bytes) => { const head = Buffer.alloc(4); head[0] = type; head.writeUIntBE(bytes.length, 1, 3); return Buffer.concat([head, bytes]); };
  return Buffer.concat([Buffer.from('fLaC'), block(0, stream), block(0x84, comment)]);
}
export function taggedM4a() {
  const atom = (type, data) => { const size = Buffer.alloc(4); size.writeUInt32BE(data.length + 8); return Buffer.concat([size, Buffer.from(type, 'latin1'), data]); };
  const field = (type, value) => atom(type, atom('data', Buffer.concat([Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]), Buffer.from(value)])));
  const meta = atom('meta', Buffer.concat([Buffer.alloc(4), atom('ilst', Buffer.concat([field('©nam', 'M4A title'), field('©ART', 'Tinglan'), field('©alb', 'Quiet Hours')]))]));
  return Buffer.concat([atom('ftyp', Buffer.concat([Buffer.from('M4A '), Buffer.alloc(4), Buffer.from('M4A isom')])), atom('moov', atom('udta', meta))]);
}

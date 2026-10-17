import { LIMITS, normalizeTrack, normalizePlaylists, normalizePreferences } from './library-data.mjs';
import {NOTE_LIMITS,normalizeNotes,normalizeNote} from './note-data.mjs';
import {LISTENING_LIMITS,normalizeListeningHistory} from './listening-data.mjs';
import {radioLibrary} from './radio-data.mjs';
import {recognitionHistory} from './recognition-data.mjs';

const MAGIC = new Uint8Array([84, 76, 66, 75, 13, 10, 26, 1]);
const PREFIX = 16;
const MAX_HEADER = 16 * 1024 * 1024;
export const MAX_BACKUP_BYTES = 2 * 1024 * 1024 * 1024;
const table = new Uint32Array(256);
for (let index = 0; index < 256; index++) {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  table[index] = crc >>> 0;
}
function updateCrc(crc, bytes) { for (const byte of bytes) crc = (crc >>> 8) ^ table[(crc ^ byte) & 255]; return crc >>> 0; }
export function crc32Bytes(bytes) { return (updateCrc(0xffffffff, bytes) ^ 0xffffffff) >>> 0; }
export async function crc32Blob(blob, onBytes = () => {}) {
  let crc = 0xffffffff;
  for await (const bytes of blob.stream()) { crc = updateCrc(crc, bytes); onBytes(bytes.length); }
  return (crc ^ 0xffffffff) >>> 0;
}
function checkTracks(values) {
  if (!Array.isArray(values) || values.length > LIMITS.tracks) throw new Error('Invalid backup track count');
  const tracks = values.map(normalizeTrack), ids = new Set(tracks.map(track => track.id));
  if (ids.size !== tracks.length) throw new Error('Duplicate track identifiers in backup');
  return { tracks, ids };
}
function mime(value) {
  if (typeof value !== 'string' || value.length > 120 || (value && !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9.+-]+$/i.test(value))) throw new Error('Invalid file type in backup');
  return value;
}
function progressReporter(total, onProgress, phase) {
  let done = 0, last = 0;
  return bytes => {
    done += bytes;
    if (Date.now() - last >= 100 || done === total) { last = Date.now(); onProgress({ phase, done, total, percent: total ? Math.min(100, Math.floor(done / total * 100)) : 100 }); }
  };
}

/** Binary container uses Blob slices; no audio base64 or whole-file ArrayBuffer allocation. */
export async function createBackup(snapshot, onProgress = () => {}) {
  const { tracks, ids } = checkTracks(snapshot.tracks);
  const playlists = normalizePlaylists(snapshot.playlists || [], ids);
  const recognized=recognitionHistory(snapshot.recognitionHistory);
  const notes=normalizeNotes(snapshot.notes);
  const media = new Map(snapshot.media.map(item => [item.id, item.blob]));
  const art = new Map(snapshot.artwork.map(item => [item.key, item.blob]));
  const payloads = [];
  for (const track of tracks) {
    const audio = media.get(track.id);
    if (track.cached) {
      if (!(audio instanceof Blob) || audio.size !== track.size) throw new Error('Missing audio file. Reimport the track before backing up');
      payloads.push({ slot: 'media', id: track.id, blob: audio });
    }
    const cover = art.get(track.id), thumb = art.get(track.id + ':thumb');
    track.hasArtwork = !!(cover instanceof Blob && thumb instanceof Blob);
    if (track.hasArtwork) {
      for (const [slot, blob] of [['cover', cover], ['thumb', thumb]]) {
        if (!blob.size || blob.size > LIMITS.artwork || !/^image\/(png|jpeg|webp|gif)$/i.test(blob.type)) throw new Error('Invalid artwork format in backup');
        payloads.push({ slot, id: track.id, blob });
      }
    }
  }
  for(const playlist of playlists) {
    const cover=art.get('playlist:'+playlist.id),thumb=art.get('playlist:'+playlist.id+':thumb');
    if(cover instanceof Blob && thumb instanceof Blob) {
      for(const [slot,blob] of [['playlist-cover',cover],['playlist-thumb',thumb]]) {
        if(!blob.size || blob.size>LIMITS.artwork || !/^image\/(png|jpeg|webp|gif)$/i.test(blob.type))throw new Error('Invalid playlist background format');
        payloads.push({slot,id:playlist.id,blob});
      }
    } else if(playlist.background==='custom')throw new Error('Missing playlist background. Choose an image again before backing up');
  }
  for(const note of notes){const blob=new Blob([JSON.stringify(note)],{type:'application/json'});if(blob.size>NOTE_LIMITS.payloadBytes)throw new Error('Notes are too large to back up');payloads.push({slot:'note',id:note.songId,blob});}
  const listening=normalizeListeningHistory(snapshot.listening);if(listening.length){const blob=new Blob([JSON.stringify(listening)],{type:'application/json'});if(blob.size>LISTENING_LIMITS.payloadBytes)throw new Error('Listening history exceeds the backup limit');payloads.push({slot:'listening',id:'history',blob});}
  const total = payloads.reduce((sum, item) => sum + item.blob.size, 0);
  if (total > MAX_BACKUP_BYTES - MAX_HEADER - PREFIX) throw new Error('Library exceeds the backup limit of 2 GB . Reduce the library size before backing up');
  const report = progressReporter(total, onProgress, 'Validating audio files');
  const entries = [];
  for (const item of payloads) entries.push({ slot: item.slot, id: item.id, size: item.blob.size, type: mime(item.blob.type), crc32: await crc32Blob(item.blob, report) });
  const manifest = { format: 'tinglan-local-backup', version: 7, appVersion: '0.29.0', createdAt: new Date().toISOString(), tracks, playlists,noteIds:notes.map(row=>row.songId),hasListening:listening.length>0,radioLibrary:radioLibrary(snapshot.radioLibrary),recognitionHistory:recognized, preferences: normalizePreferences(snapshot.preferences, ids), entries };
  const header = new TextEncoder().encode(JSON.stringify(manifest));
  if (header.length > MAX_HEADER) throw new Error('Lyrics and metadata exceed the backup limit of 16 MB maximum');
  const prefix = new Uint8Array(PREFIX); prefix.set(MAGIC);
  const view = new DataView(prefix.buffer); view.setUint32(8, header.length, true); view.setUint32(12, crc32Bytes(header), true);
  onProgress({ phase: 'Backup ready', percent: 100, done: total, total });
  return { blob: new Blob([prefix, header, ...payloads.map(item => item.blob)], { type: 'application/x-tinglan-backup' }), tracks: tracks.length, playlists: playlists.length,notes:notes.length,listening:listening.length };
}

export async function readBackup(file, onProgress = () => {}) {
  if (!(file instanceof Blob) || file.size < PREFIX || file.size > MAX_BACKUP_BYTES) throw new Error('Choose a complete Tinglan backup no larger than 2 GB');
  const prefix = new Uint8Array(await file.slice(0, PREFIX).arrayBuffer());
  if (!MAGIC.every((byte, index) => byte === prefix[index])) throw new Error('This is not a supported Tinglan backup');
  const view = new DataView(prefix.buffer), length = view.getUint32(8, true);
  if (!length || length > MAX_HEADER || PREFIX + length > file.size) throw new Error('Backup metadata is damaged or incomplete');
  const bytes = new Uint8Array(await file.slice(PREFIX, PREFIX + length).arrayBuffer());
  if (crc32Bytes(bytes) !== view.getUint32(12, true)) throw new Error('Backup metadata validation failed. Existing music is unchanged');
  let manifest;
  try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('Unable to read backup metadata'); }
  if (manifest?.format !== 'tinglan-local-backup' || ![1,2,3,4,5,6,7].includes(manifest.version)) throw new Error('Unsupported backup version');
  if (manifest.version === 1 && manifest.tracks?.some(track => track.source && track.source !== 'local')) throw new Error('Legacy backup contains invalid online tracks');
  const { tracks, ids } = checkTracks(manifest.tracks);
  const playlists = normalizePlaylists(manifest.playlists, ids);
  const recognized=recognitionHistory(manifest.recognitionHistory);
  const noteIds=manifest.version>=3?manifest.noteIds:[];
  if(!Array.isArray(noteIds) || noteIds.length>NOTE_LIMITS.notes || new Set(noteIds).size!==noteIds.length || noteIds.some(id=>typeof id!=='string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id)))throw new Error('Invalid backup note index');
  const noteKeys=new Set(noteIds);
  const playlistKeys=new Set(playlists.map(p=>p.id));
  const stations=manifest.version>=5?radioLibrary(manifest.radioLibrary):radioLibrary();
  if(manifest.version>=4 && typeof manifest.hasListening!=='boolean')throw new Error('Invalid listening history index');
  if (!Array.isArray(manifest.entries) || manifest.entries.length > LIMITS.tracks * 3+NOTE_LIMITS.notes+1+LIMITS.playlists*2) throw new Error('Invalid backup file index');
  const keys = new Set();
  let size = PREFIX + length;
  for (const entry of manifest.entries) {
    if (!entry || !['media', 'cover', 'thumb','note','listening','playlist-cover','playlist-thumb'].includes(entry.slot) || !(entry.slot==='listening'?manifest.version>=4 && manifest.hasListening && entry.id==='history':(entry.slot.startsWith('playlist-')?manifest.version>=7 && playlistKeys.has(entry.id):(entry.slot==='note'?noteKeys:ids).has(entry.id)))) throw new Error('Backup contains unknown files');
    const key = entry.slot + ':' + entry.id;
    if (keys.has(key)) throw new Error('Duplicate backup file index'); keys.add(key);
    const limit = entry.slot==='listening'?LISTENING_LIMITS.payloadBytes:entry.slot==='note'?NOTE_LIMITS.payloadBytes:entry.slot === 'media' ? LIMITS.audio : LIMITS.artwork;
    if (!Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size > limit || !Number.isSafeInteger(entry.crc32) || entry.crc32 < 0 || entry.crc32 > 0xffffffff) throw new Error('Damaged backup file index');
    mime(entry.type);
    if(['note','listening'].includes(entry.slot) && entry.type!=='application/json')throw new Error('Invalid backup record format');
    if(!['media','note','listening'].includes(entry.slot) && !/^image\/(png|jpeg|webp|gif)$/i.test(entry.type))throw new Error('Invalid backup artwork format');
    size += entry.size;
    if (size > file.size) throw new Error('Incomplete backup audio file');
  }
  if (size !== file.size) throw new Error('Incorrect backup file length');
  const indexed = new Map(manifest.entries.map(entry => [entry.slot + ':' + entry.id, entry]));
  if(noteIds.some(id=>!keys.has('note:'+id)))throw new Error('Missing notes in backup');
  if(manifest.hasListening===true && !keys.has('listening:history'))throw new Error('Missing listening history in backup');
  for (const track of tracks) {
    if (track.cached && indexed.get('media:' + track.id)?.size !== track.size) throw new Error('Missing audio files in backup');
    if (!track.cached && indexed.has('media:' + track.id)) throw new Error('Inconsistent online-track cache metadata');
    if (track.hasArtwork !== (keys.has('cover:' + track.id) && keys.has('thumb:' + track.id))) throw new Error('Inconsistent backup artwork index');
    if (keys.has('cover:' + track.id) !== keys.has('thumb:' + track.id)) throw new Error('Incomplete backup artwork');
  }
  for(const p of playlists){const cover=keys.has('playlist-cover:'+p.id),thumb=keys.has('playlist-thumb:'+p.id);if(cover!==thumb || (p.background==='custom' && !cover))throw new Error('Incomplete playlist background index');}
  const report = progressReporter(file.size - PREFIX - length, onProgress, 'Verifying backup integrity');
  const media = [], artwork = [],notes=[];let listening=[]; let offset = PREFIX + length;
  for (const entry of manifest.entries) {
    const blob = file.slice(offset, offset + entry.size, entry.type); offset += entry.size;
    if (await crc32Blob(blob, report) !== entry.crc32) throw new Error('Backup verification failed. Existing music is unchanged');
    if(entry.slot==='note'){let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await blob.arrayBuffer()));}catch{throw new Error('Unable to read backup notes');}const note=normalizeNote(value);if(note.songId!==entry.id)throw new Error('Backup note identifiers do not match');notes.push(note);}
    else if(entry.slot==='listening'){try{listening=normalizeListeningHistory(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await blob.arrayBuffer())));}catch{throw new Error('Unable to read listening history in backup');}if(!listening.length)throw new Error('Listening history index does not match its contents');}
    else if (entry.slot === 'media') media.push({ id: entry.id, blob });
    else artwork.push({ key:(entry.slot.startsWith('playlist-')?'playlist:':'')+entry.id+(['thumb','playlist-thumb'].includes(entry.slot)?':thumb':''),blob });
  }
  return { tracks, playlists, media, artwork,notes,listening,radioLibrary:stations,recognitionHistory:recognized, preferences: normalizePreferences(manifest.preferences, ids), createdAt: manifest.createdAt };
}

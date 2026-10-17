import {fileIdentity,trackFromFile} from './storage.mjs';
import {normalizeTrack,LIMITS} from './library-data.mjs';
import {audioFilename} from './lan-transfer-policy.mjs';

/** Validate received audio and commit original bytes, metadata and artwork in one local transaction. */
export async function importLanAudio(file,{signal,sha256}={},host) {
  signal?.throwIfAborted();audioFilename(file.name);
  if(!file.size || file.size>LIMITS.audio)throw new Error('Invalid received audio size');
  if(sha256!==undefined && !/^[a-f0-9]{64}$/.test(sha256))throw new Error('Invalid received-file checksum identifier');
  const id=sha256?'local-'+sha256:await fileIdentity(file);signal?.throwIfAborted();if(host.records.has(id))return id;
  if(host.records.size>=LIMITS.tracks)throw new Error('Library has reached its 10000 track limit');
  const tags=await host.parse(file);signal?.throwIfAborted();
  if(!tags?.audioDetected)throw new Error('No readable audio in this file. Check the original');
  const fallback=trackFromFile(file,id),record=normalizeTrack({...fallback,...tags,title:tags.title || fallback.title,artist:tags.artist || fallback.artist,source:'local',cached:true,hasArtwork:!!tags.cover});
  let art;if(tags.cover)try{art=await host.artwork(tags.cover);}catch{record.hasArtwork=false;}
  signal?.throwIfAborted();if(host.records.has(id))return id;if(host.records.size>=LIMITS.tracks)throw new Error('Library has reached its 10000 track limit');
  const undo=host.beforeCommit?.(record);
  try{await host.store.putTrack(record,file,art,{signal,maxTracks:LIMITS.tracks});}catch(error){undo?.();throw error;}
  host.records.set(id,record);host.upsert(record);host.changed();return id;
}

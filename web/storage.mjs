import {tr} from './i18n.mjs';
import {noteIndexes,restoreNotes} from './note-storage.mjs';
import {listeningIndexes,restoreListening} from './listening-storage.mjs';
import {radioLibrary,mergeRadioLibraries} from './radio-data.mjs';
import {recognitionHistory,mergeRecognitionHistory} from './recognition-data.mjs';
import {mediaChanged,mediaRemoved} from './media-identity.mjs';
import {storageName} from './deployment.mjs';
const DATABASE = storageName('tinglan-web-library');
const VERSION = 6;

export class LibraryStore {
  async open() {
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, VERSION);
      request.onupgradeneeded = () => {
        for (const name of ['tracks', 'media', 'artwork', 'settings', 'playlists', 'catalog','notes','listening','fingerprints']) {
          if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
        }
        noteIndexes(request.transaction.objectStore('notes'));
        listeningIndexes(request.transaction.objectStore('listening'));
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error(tr("Close other Tinglan tabs and retry")));
    });
    this.db.onversionchange = () => this.db.close();
  }
  async read(store, key) {
    return new Promise((resolve, reject) => {
      const request = this.db.transaction(store).objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async tracks() {
    return new Promise((resolve, reject) => {
      const request = this.db.transaction('tracks').objectStore('tracks').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async write(stores, operation,{signal}={}) {
    return new Promise((resolve, reject) => {
      if(signal?.aborted){reject(signal.reason || new DOMException('Cancelled','AbortError'));return;}
      const transaction = this.db.transaction(stores, 'readwrite');
      const abort=()=>{try{transaction.abort();}catch{}},finish=(error,success=false)=>{signal?.removeEventListener('abort',abort);success?resolve():reject(error || new Error(tr("Local save incomplete")));};
      const failure=event=>signal?.aborted?signal.reason || new DOMException('Cancelled','AbortError'):transaction.error || event?.target?.error || new Error(tr("Local save incomplete"));
      signal?.addEventListener('abort',abort,{once:true});
      transaction.oncomplete = () => finish(undefined,true);
      transaction.onerror = event => finish(failure(event));
      transaction.onabort = event => finish(failure(event));
      try { operation(transaction); } catch (error) { transaction.abort(); reject(error); }
    });
  }
  putTrack(track, file, artwork,options) {
    return this.write(['tracks', 'media', 'artwork','settings','fingerprints'], tx => {
      tx.objectStore('tracks').put(track, track.id);
      if(options?.maxTracks){const count=tx.objectStore('tracks').count();count.onsuccess=()=>{if(count.result>options.maxTracks)tx.abort();};}
      if (file instanceof Blob) {tx.objectStore('media').put(file, track.id);mediaChanged(tx,track.id);}
      if (artwork) { tx.objectStore('artwork').put(artwork[0], track.id); tx.objectStore('artwork').put(artwork[1], track.id + ':thumb'); }
    },options);
  }
  updateTrack(track) { return this.write(['tracks'], tx => tx.objectStore('tracks').put(track, track.id)); }
  patchTrack(id, patch) {
    return this.write(['tracks'], tx => {
      const target = tx.objectStore('tracks'); const request = target.get(id);
      request.onsuccess = () => { if (request.result) target.put({ ...request.result, ...patch, id }, id); };
    });
  }
  favoriteTracks(ids){return this.write(['tracks'],tx=>{const rows=tx.objectStore('tracks');for(const id of ids){const request=rows.get(id);request.onsuccess=()=>{if(request.result)rows.put({...request.result,favorite:true},id);};}});}
  setArtwork(id, blob, thumbnail) {
    return this.write(['artwork', 'tracks'], tx => {
      const target = tx.objectStore('tracks'); const request = target.get(id);
      request.onsuccess = () => {
        if (!request.result) return;
        tx.objectStore('artwork').put(blob, id); tx.objectStore('artwork').put(thumbnail, id + ':thumb');
        target.put({ ...request.result, hasArtwork: true }, id);
      };
    });
  }
  remove(id) {
    return this.write(['tracks', 'media', 'artwork', 'playlists','settings','fingerprints'], tx => {
      tx.objectStore('tracks').delete(id); tx.objectStore('media').delete(id);
      mediaRemoved(tx,id);
      tx.objectStore('artwork').delete(id); tx.objectStore('artwork').delete(id + ':thumb');
      const request = tx.objectStore('playlists').openCursor();
      request.onsuccess = () => {
        const cursor = request.result; if (!cursor) return;
        const playlist = cursor.value;
        if (playlist.trackIds?.includes(id)) cursor.update({ ...playlist, trackIds: playlist.trackIds.filter(trackId => trackId !== id),...(playlist.backgroundTrackId===id?{background:'none',backgroundTrackId:''}:{}) });
        cursor.continue();
      };
    });
  }
  settings() { return this.read('settings', 'preferences'); }
  saveSettings(value) { return this.write(['settings'], tx => tx.objectStore('settings').put(value, 'preferences')); }
  playlists() { return this.all('playlists'); }
  all(name) {
    return new Promise((resolve, reject) => {
      const request = this.db.transaction(name).objectStore(name).getAll();
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }
  putPlaylist(value) { return this.write(['playlists'], tx => tx.objectStore('playlists').put(value, value.id)); }
  setPlaylistArtwork(value,full,thumb) {
    return this.write(['playlists','artwork'],tx=>{
      tx.objectStore('playlists').put(value,value.id);
      tx.objectStore('artwork').put(full,'playlist:'+value.id);
      tx.objectStore('artwork').put(thumb,'playlist:'+value.id+':thumb');
    });
  }
  importHandoff(records) {
    if(!Array.isArray(records) || records.length<1 || records.length>40 || new Set(records.map(row=>row?.id)).size!==records.length || records.some(row=>typeof row?.id!=='string' || !row.id))return Promise.reject(new Error(tr("Invalid handoff track list")));
    const accepted=Array(records.length);
    return this.write(['tracks'],tx=>{
      const store=tx.objectStore('tracks');let pending=records.length+1,total=0,added=0;
      const complete=()=>{if(--pending===0){if(total+added>10000){tx.abort();return;}for(const value of accepted)store.put(value,value.id);}};
      const count=store.count();count.onsuccess=()=>{total=count.result;complete();};
      records.forEach((record,index)=>{const request=store.get(record.id);request.onsuccess=()=>{accepted[index]=request.result || record;if(!request.result)++added;complete();};});
    }).then(()=>accepted);
  }
  importPlaylist(records,playlist,{signal}={}) {
    if(!Array.isArray(records) || records.length>10000 || !playlist?.id || !playlist.name || !Array.isArray(playlist.trackIds) || playlist.trackIds.length>10000)return Promise.reject(new Error(tr("Invalid playlist content")));
    const unique=new Map(records.map(row=>[row?.id,row]));
    if(unique.has(undefined) || [...unique.keys()].some(id=>typeof id!=='string' || !id || id.length>200) || playlist.trackIds.some(id=>!unique.has(id)) || new Set(playlist.trackIds).size!==playlist.trackIds.length)return Promise.reject(new Error(tr("Invalid playlist track identifier")));
    records=[...unique.values()];const accepted=Array(records.length);let abort;
    return this.write(['tracks','playlists'],tx=>{
      signal?.throwIfAborted();abort=()=>{try{tx.abort();}catch{/* A completed transaction is already committed. */}};signal?.addEventListener('abort',abort,{once:true});
      const tracks=tx.objectStore('tracks'),playlists=tx.objectStore('playlists');let pending=records.length+3,added=0,total=0,playlistTotal=0,existingPlaylist=false;
      const check=()=>{if(--pending===0){if(total+added>10000 || playlistTotal+(existingPlaylist?0:1)>200)tx.abort();else playlists.put(playlist,playlist.id);}};
      const tracksCount=tracks.count();tracksCount.onsuccess=()=>{total=tracksCount.result;check();};
      const playlistCount=playlists.count();playlistCount.onsuccess=()=>{playlistTotal=playlistCount.result;check();};
      const old=playlists.get(playlist.id);old.onsuccess=()=>{existingPlaylist=!!old.result;check();};
      for(const [index,record] of records.entries()) {
        const request=tracks.get(record.id);
        request.onsuccess=()=>{const value=request.result || record;accepted[index]=value;if(!request.result){try{tracks.put(record,record.id);++added;}catch{tx.abort();return;}}check();};
      }
    }).then(()=>accepted).catch(error=>{signal?.throwIfAborted();throw error;}).finally(()=>{if(abort)signal?.removeEventListener('abort',abort);});
  }
  removePlaylist(id) { return this.write(['playlists','artwork'], tx => {tx.objectStore('playlists').delete(id);tx.objectStore('artwork').delete('playlist:'+id);tx.objectStore('artwork').delete('playlist:'+id+':thumb');}); }
  async cacheCatalog(key, value) {
    await this.write(['catalog'], tx => tx.objectStore('catalog').put({ ...value, cachedAt: Date.now() }, key));
    const keys = await new Promise((resolve,reject) => { const request=this.db.transaction('catalog').objectStore('catalog').getAllKeys();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error); });
    if(keys.length>80)await this.write(['catalog'],tx=>keys.slice(0,keys.length-80).forEach(id=>tx.objectStore('catalog').delete(id)));
  }
  async snapshot() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['tracks', 'media', 'artwork', 'playlists', 'settings','notes','listening']);
      const output = { tracks: [], media: [], artwork: [], playlists: [], preferences: {},notes:[],listening:[] };
      for (const [name, field] of [['tracks', 'tracks'], ['playlists', 'playlists'],['notes','notes'],['listening','listening']]) {
        const request = tx.objectStore(name).getAll(); request.onsuccess = () => { output[field] = request.result; };
      }
      for (const name of ['media', 'artwork']) {
        const request = tx.objectStore(name).openCursor(); request.onsuccess = () => {
          const cursor = request.result; if (!cursor) return;
          output[name].push(name === 'media' ? { id: cursor.key, blob: cursor.value } : { key: cursor.key, blob: cursor.value }); cursor.continue();
        };
      }
      const request = tx.objectStore('settings').get('preferences'); request.onsuccess = () => { output.preferences = request.result || {}; };
      const radios=tx.objectStore('settings').get('radio-library');radios.onsuccess=()=>{output.radioLibrary=radios.result || {};};
      const recognition=tx.objectStore('settings').get('recognition-history');recognition.onsuccess=()=>{output.recognitionHistory=recognition.result || [];};
      tx.oncomplete = () => resolve(output); tx.onerror = tx.onabort = () => reject(tx.error || new Error(tr("Unable to read the complete library")));
    });
  }
  mergeBackup(snapshot, preferences) {
    return this.write(['tracks', 'media', 'artwork', 'playlists', 'settings','notes','listening','fingerprints'], tx => {
      restoreNotes(tx,snapshot.notes);
      restoreListening(tx,snapshot.listening);
      const recognition=tx.objectStore('settings').get('recognition-history');recognition.onsuccess=()=>{try{tx.objectStore('settings').put(mergeRecognitionHistory(recognition.result,snapshot.recognitionHistory),'recognition-history');}catch{tx.abort();}};
      const settings=tx.objectStore('settings'),radios=settings.get('radio-library');radios.onsuccess=()=>{try{settings.put(mergeRadioLibraries(radios.result || {},radioLibrary(snapshot.radioLibrary)),'radio-library');}catch{tx.abort();}};
      for (const track of snapshot.tracks) {
        tx.objectStore('tracks').put(track, track.id);
        tx.objectStore('artwork').delete(track.id); tx.objectStore('artwork').delete(track.id + ':thumb');
        tx.objectStore('media').delete(track.id);
        mediaChanged(tx,track.id);
      }
      for(const p of snapshot.playlists){tx.objectStore('artwork').delete('playlist:'+p.id);tx.objectStore('artwork').delete('playlist:'+p.id+':thumb');}
      for (const item of snapshot.media) tx.objectStore('media').put(item.blob, item.id);
      for (const item of snapshot.artwork) tx.objectStore('artwork').put(item.blob, item.key);
      for (const playlist of snapshot.playlists) tx.objectStore('playlists').put(playlist, playlist.id);
      tx.objectStore('settings').put(preferences, 'preferences');
    });
  }
  clearCatalog() { return this.write(['catalog'], tx => tx.objectStore('catalog').clear()); }
}

export async function fileIdentity(file) {
  const header = new Uint8Array(await file.slice(0, 65_536).arrayBuffer());
  const metadata = new TextEncoder().encode(`${file.name}\n${file.size}\n${file.lastModified}\n`);
  const bytes = new Uint8Array(metadata.length + header.length);
  bytes.set(metadata); bytes.set(header, metadata.length);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return 'local-' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function trackFromFile(file, id) {
  const basename = file.name.replace(/\.[^.]+$/, '');
  const split = basename.indexOf(' - ');
  return {
    id, title: split > 0 ? basename.slice(split + 3) : basename,
    artist: split > 0 ? basename.slice(0, split) : tr("Local music"),
    filename: file.name, size: file.size, type: file.type, durationMs: 0,
    favorite: false, lyrics: '', addedAt: Date.now(), hasArtwork: false,
  };
}

export async function resizeArtwork(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error(tr("Artwork must be smaller than 20 MB"));
  const bitmap = await createImageBitmap(file);
  try {
    const render = async limit => {
      const scale = Math.min(1, limit / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error(tr("Unable to process artwork"))), 'image/webp', .85));
    };
    return [await render(640), await render(96)];
  } finally { bitmap.close(); }
}

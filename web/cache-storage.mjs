import {tr} from './i18n.mjs';
import {cacheKind,cacheTime,cacheTotals,cachePatch,clearedCache,evictionPlan} from './cache-policy.mjs';
import {mediaChanged} from './media-identity.mjs';

const summary=row=>({...cachePatch(row),source:row.source || 'local',addedAt:cacheTime(row.addedAt),favorite:row.favorite===true});
function scan(tx,complete){
  const rows=[],r=tx.objectStore('tracks').openCursor();
  r.onsuccess=()=>{const cursor=r.result;if(!cursor){complete(rows);return;}rows.push(summary(cursor.value));cursor.continue();};
}
function clearStored(tx,row,updates,{protectedIds=()=>new Set(),skipped=()=>{},cleared=()=>{}}={}){
  const tracks=tx.objectStore('tracks'),r=tracks.get(row.id);
  r.onsuccess=()=>{if(!r.result)return;if(protectedIds().has(row.id)){skipped();return;}const value=clearedCache(r.result);tracks.put(value,row.id);tx.objectStore('media').delete(row.id);mediaChanged(tx,row.id);updates.push(cachePatch(value));cleared(r.result.size);};
}

/** Cache bytes and the latest metadata change together; no song, lyrics or playlist is deleted. */
export class CacheStore {
  constructor(store){this.store=store;}
  async inspect(){
    let tracks=[],artworkBytes=0;
    await new Promise((resolve,reject)=>{const tx=this.store.db.transaction(['tracks','artwork']),r=tx.objectStore('artwork').openCursor();scan(tx,rows=>{tracks=rows;});r.onsuccess=()=>{const c=r.result;if(c){artworkBytes+=c.value instanceof Blob?c.value.size:0;c.continue();}};tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error || new Error(tr("Unable to read local storage usage")));});
    return {...cacheTotals(tracks),artworkBytes,cacheRecords:tracks};
  }
  async touch(id,at){await this.store.write(['tracks'],tx=>{const s=tx.objectStore('tracks'),r=s.get(id);r.onsuccess=()=>{if(cacheKind(r.result)==='automatic')s.put({...r.result,cacheTouchedAt:cacheTime(at)},id);};});}
  async save(id,audio,{mode='download',at=Date.now(),limit=Infinity,protectedIds=()=>new Set(),keepFavorites=true,assets={},signal}={}) {
    let updates=[],saved,extraError;
    try{
      await this.store.write(['tracks','media','artwork','settings','fingerprints'],tx=>{
        const tracks=tx.objectStore('tracks'),r=tracks.get(id),media=tx.objectStore('media').get(id);let pending=mode==='automatic'?3:2,rows=[];
        const apply=()=>{
          if(--pending)return;
          try{
            signal?.throwIfAborted();const current=r.result;
            if(!current || !['qq','bili','netease'].includes(current.source))throw new Error(tr("Track removed. Cache task cancelled"));
            const existing=media.result instanceof Blob && media.result.size===current.size?cacheKind(current):'';
            if(existing && mode==='automatic'){saved=current;return;}
            if(!existing && (!(audio instanceof Blob) || !audio.size))throw new Error(tr("Downloaded audio is incomplete"));
            const savedMode=mode==='download' || existing==='download'?'download':'automatic';
            const size=existing?current.size:audio.size;
            if(savedMode==='automatic'){
              if(!Number.isFinite(limit) && limit!==Infinity || limit<=0 || size>limit)throw new Error(tr("Track exceeds the automatic cache limit. Choose offline download"));
              const others=rows.filter(row=>row.id!==id),total=cacheTotals(others).automaticBytes;
              if(total+size>limit){
                const plan=evictionPlan(others,{target:Math.max(0,limit*.85-size),protectedIds:protectedIds(),keepFavorites});
                if(plan.remaining+size>limit)throw new Error(tr("Automatic cache is full. Playing and retained tracks are protected"));
                for(const row of plan.remove)clearStored(tx,row,updates,{protectedIds,skipped:()=>{extraError=new Error(tr("Queue changed. Automatic caching deferred"));tx.abort();}});
              }
            }
            saved={...current,cached:true,size,type:existing?current.type:audio.type,cacheMode:savedMode,cacheSavedAt:cacheTime(current.cacheSavedAt)||cacheTime(at),cacheTouchedAt:cacheTime(at)};
            if(!current.lyricsEdited && !current.lyrics && typeof assets.lyrics?.text==='string' && assets.lyrics.text.length<=200000 && assets.lyrics.text){saved.lyrics=assets.lyrics.text;saved.originalLyrics=assets.lyrics.text;saved.lyricsSource=['qq','bili','netease','kugou'].includes(assets.lyrics.source)?assets.lyrics.source:current.source;}
            if(assets.artwork?.length===2){
              const art=tx.objectStore('artwork'),full=art.get(id),thumb=art.get(id+':thumb');let pending=2;
              const check=()=>{if(--pending || full.result instanceof Blob && thumb.result instanceof Blob)return;
                try{art.put(assets.artwork[0],id);art.put(assets.artwork[1],id+':thumb');saved.hasArtwork=true;tracks.put(saved,id);}catch(error){extraError=error;tx.abort();}
              };full.onsuccess=check;thumb.onsuccess=check;
            }
            if(!existing){tx.objectStore('media').put(audio,id);mediaChanged(tx,id);}
            tracks.put(saved,id);updates.push(saved);
          }catch(error){extraError=error;tx.abort();}
        };r.onsuccess=apply;media.onsuccess=apply;if(mode==='automatic')scan(tx,value=>{rows=value;apply();});
      },{signal});
    }catch(error){throw extraError || error;}
    return {saved,updates};
  }
  async missing(id){
    let updates=[];
    await this.store.write(['tracks','media','settings','fingerprints'],tx=>{
      const tracks=tx.objectStore('tracks'),track=tracks.get(id),audio=tx.objectStore('media').get(id);let pending=2;
      const check=()=>{if(--pending)return;const row=track.result;if(row && ['automatic','download'].includes(cacheKind(row)) && (!(audio.result instanceof Blob) || audio.result.size!==row.size)){const cleared=clearedCache(row);tracks.put(cleared,id);tx.objectStore('media').delete(id);mediaChanged(tx,id);updates=[cleared];}};
      track.onsuccess=check;audio.onsuccess=check;
    });return {updates};
  }
  async clean({ids,limit=0,target=limit,protectedIds=()=>new Set(),keepFavorites=true,signal}={}) {
    let updates=[],blocked=false,freedBytes=0;
    await this.store.write(['tracks','media','settings','fingerprints'],tx=>{
      const tracks=tx.objectStore('tracks');
      const apply=values=>{
        const selected=ids?new Set(ids):null,protectedNow=protectedIds();
        let rows;
        if(selected){rows=values.filter(row=>selected.has(row.id) && cacheKind(row) && cacheKind(row)!=='local' && !protectedNow.has(row.id));blocked=rows.length<selected.size;}
        else {const plan=evictionPlan(values,{target,protectedIds:protectedNow,keepFavorites});rows=plan.remove;blocked=plan.blocked;}
        for(const row of rows)clearStored(tx,row,updates,{protectedIds,skipped:()=>{blocked=true;},cleared:bytes=>{freedBytes+=bytes;}});
      };
      if(ids){const wanted=[...new Set(ids)],rows=[];let pending=wanted.length;if(!pending)apply(rows);for(const id of wanted){const r=tracks.get(id);r.onsuccess=()=>{if(r.result)rows.push(summary(r.result));if(--pending===0)apply(rows);};}}
      else scan(tx,apply);
    },{signal});
    return {updates,blocked,freedBytes};
  }
}

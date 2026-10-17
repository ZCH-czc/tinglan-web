export const CACHE_LIMITS = Object.freeze({queue:20, history:20, fileBytes:512*1024*1024, progressMs:150, timeoutMs:120000, pageSize:24});
export const CACHE_BUDGETS = Object.freeze([0,256,512,1024,2048,4096,-1]);
export const cacheBudget = mb => mb === -1 ? Infinity : Math.max(0,mb)*1048576;
export const cacheKind = track => !track ? '' : !track.source || track.source === 'local' ? (track.size>0?'local':'') : !track.cached ? '' : track.cacheMode === 'automatic' ? 'automatic' : 'download';
export const cacheTime = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
export const cachePatch = track => ({id:track.id,cached:!!cacheKind(track),size:track.size,type:track.type,cacheMode:['download','automatic'].includes(cacheKind(track))?cacheKind(track):'',cacheTouchedAt:cacheTime(track.cacheTouchedAt),cacheSavedAt:cacheTime(track.cacheSavedAt)});
export function cacheTotals(tracks) {
  const result={automaticBytes:0,downloadBytes:0,localBytes:0,automaticCount:0,downloadCount:0,localCount:0};
  for(const track of tracks){const kind=cacheKind(track);if(kind){result[kind+'Bytes']+=Math.max(0,Number(track.size)||0);++result[kind+'Count'];}}
  return result;
}
/** Mirrors Android's 90% pressure, 85% trim and 75% hysteresis thresholds. */
export class CachePressure {
  constructor(){this.notice=null;this.cycle=false;this.limit=0;this.token=0;}
  observe(used,limit){
    if(this.limit!==limit){this.cycle=false;this.limit=limit;}
    if(!Number.isFinite(limit) || limit<=0 || used<limit*.75)this.cycle=false;
    if(!this.cycle && Number.isFinite(limit) && limit>0 && used>=limit*.9){this.cycle=true;this.notice={token:String(++this.token),used,limit};}
    return this.notice;
  }
  acknowledge(token){if(this.notice?.token===token)this.notice=null;}
}
export function evictionPlan(tracks,{target=0,protectedIds=new Set(),keepFavorites=true,exclude=''}={}) {
  let used=cacheTotals(tracks).automaticBytes;
  const candidates=tracks.filter(row=>cacheKind(row)==='automatic' && row.id!==exclude && !protectedIds.has(row.id) && (!keepFavorites || !row.favorite))
    .sort((a,b)=>(cacheTime(a.cacheTouchedAt)||cacheTime(a.cacheSavedAt)||cacheTime(a.addedAt))-(cacheTime(b.cacheTouchedAt)||cacheTime(b.cacheSavedAt)||cacheTime(b.addedAt)) || a.id.localeCompare(b.id));
  const remove=[];
  for(const row of candidates){if(used<=target)break;remove.push(row);used-=row.size;}
  return {remove,remaining:used,blocked:used>target};
}
export function clearedCache(track){return {...track,cached:false,size:0,type:'',cacheMode:'',cacheTouchedAt:0,cacheSavedAt:0};}

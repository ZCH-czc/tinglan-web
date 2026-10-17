import {tr} from './i18n.mjs';
/** Music identity only. Captured PCM, fingerprints and microphone identifiers are never persisted. */
import {parseBilibiliId} from './bilibili-id.mjs';
export const RECOGNITION_LIMITS=Object.freeze({seconds:6,sampleRate:8000,history:100,page:12,fileBytes:64*1024*1024,signatureBytes:65536});
export function recognitionSong(value) {
  const source=value?.source || 'local',remoteId=typeof value?.remoteId==='string'?value.remoteId:'';
  const valid=source==='local'?typeof value?.id==='string' && /^[A-Za-z0-9_-]{1,200}$/.test(value.id) && !/^(qq|bili|netease)-/.test(value.id):['qq','bili','netease'].includes(source) && value?.id===`${source}-${remoteId}` && (source==='bili'?!!parseBilibiliId(remoteId):source==='netease'?/^[1-9]\d{0,18}$/.test(remoteId):/^[A-Za-z0-9]{1,40}$/.test(remoteId));
  if(!valid)throw new Error(tr("Invalid recognized track identifier"));
  const text=(key,limit)=>typeof value[key]==='string'?value[key].slice(0,limit):'';
  const title=text('title',300).trim();if(!title)throw new Error(tr("Recognition result is missing a track title"));
  let artworkUrl='';try{const u=new URL(value.artworkUrl),hosts={qq:['y.gtimg.cn'],bili:['hdslb.com'],netease:['music.126.net']}[source] || [];if(u.protocol==='https:' && !u.username && !u.password && (!u.port || u.port==='443') && hosts.some(h=>u.hostname===h || u.hostname.endsWith('.'+h)))artworkUrl=u.href;}catch{}
  return {id:value.id,remoteId,source,title,artist:text('artist',500) || tr("Unknown artist"),album:text('album',300),creatorId:/^[A-Za-z0-9_]{1,40}$/.test(value.creatorId)?value.creatorId:'',creatorName:text('creatorName',500),artworkUrl,hasArtwork:!!artworkUrl || source==='local' && value.hasArtwork===true,durationMs:Number.isFinite(value.durationMs)?Math.min(86400000,Math.max(0,Math.floor(value.durationMs))):0,favorite:false,cached:false,size:0,recognizedVia:value.recognizedVia==='local'?'local':'online'};
}
export function recognitionHistory(values) {
  if(values===undefined)return [];
  if(!Array.isArray(values) || values.length>RECOGNITION_LIMITS.history)throw new Error(tr("Recognition history exceeds 100 entry limit"));
  const seen=new Set(),rows=[];
  for(const value of values){const song=recognitionSong(value);if(!Number.isSafeInteger(value.recognizedAt) || value.recognizedAt<=0 || value.recognizedAt>8640000000000000)throw new Error(tr("Invalid recognition history timestamp"));if(seen.has(song.id))continue;seen.add(song.id);rows.push({...song,recognizedAt:value.recognizedAt});}
  return rows.sort((a,b)=>b.recognizedAt-a.recognizedAt);
}
export function recognitionPage(rows,query='',page=0) {
  const q=String(query).slice(0,200).trim().normalize('NFKC').toLocaleLowerCase('en-US');
  const found=rows.filter(row=>!q || `${row.title}\n${row.artist}\n${row.album}`.normalize('NFKC').toLocaleLowerCase('en-US').includes(q));
  const pages=Math.max(1,Math.ceil(found.length/RECOGNITION_LIMITS.page)),selected=Math.max(0,Math.min(pages-1,Math.floor(Number(page)||0)));
  return {items:found.slice(selected*RECOGNITION_LIMITS.page,(selected+1)*RECOGNITION_LIMITS.page),page:selected,pages,count:found.length};
}
export function mergeRecognitionHistory(a,b){const rows=new Map();for(const row of [...recognitionHistory(a),...recognitionHistory(b)])if(!rows.has(row.id) || row.recognizedAt>rows.get(row.id).recognizedAt)rows.set(row.id,row);return [...rows.values()].sort((a,b)=>b.recognizedAt-a.recognizedAt).slice(0,RECOGNITION_LIMITS.history);}
export class RecognitionHistory {
  constructor(store){this.store=store;}
  async list(){return recognitionHistory(await this.store.read('settings','recognition-history'));}
  async save(song,{signal,now=Date.now()}={}) {
    const row={...recognitionSong(song),recognizedAt:now};recognitionHistory([row]);
    await this.store.write(['settings'],tx=>{const target=tx.objectStore('settings'),request=target.get('recognition-history');request.onsuccess=()=>{try{const rows=recognitionHistory(request.result);target.put([row,...rows.filter(old=>old.id!==row.id)].slice(0,RECOGNITION_LIMITS.history),'recognition-history');}catch{tx.abort();}};},{signal});
  }
  clear(){return this.store.write(['settings'],tx=>tx.objectStore('settings').delete('recognition-history'));}
}

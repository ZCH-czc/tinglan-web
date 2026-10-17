import {tr} from './i18n.mjs';
export const RADIO_LIMITS=Object.freeze({page:48,stations:400,favorites:200,recent:80,queue:400,query:120});
export function radioUrl(value) {
  if(typeof value!=='string' || !value.trim() || value.length>4096 || /[\u0000-\u001f]/.test(value))return null;
  try{const url=new URL(value.trim());if(url.protocol!=='https:' || url.username || url.password || !url.hostname)return null;url.hash='';return url.href;}catch{return null;}
}
export function radioStation(value) {
  if(!value || typeof value.uuid!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.uuid) || typeof value.name!=='string' || !value.name.trim() || value.name.length>160 || !radioUrl(value.streamUrl))throw new Error(tr("Invalid station metadata"));
  const streamUrl=radioUrl(value.streamUrl);if(/\.(pls|m3u)$/i.test(new URL(streamUrl).pathname))throw new Error(tr("Use a direct audio stream or HLS（m3u8）URL"));
  return {uuid:value.uuid.toLowerCase(),name:value.name.trim(),streamUrl,artworkUrl:radioUrl(value.artworkUrl) || '',countryCode:String(value.countryCode || '').slice(0,2),region:String(value.region || '').slice(0,80),tags:String(value.tags || '').slice(0,200),codec:String(value.codec || '').slice(0,20),bitrate:Number.isSafeInteger(value.bitrate)?Math.max(0,Math.min(10000,value.bitrate)):0,hls:value.hls===true || /\.m3u8$/i.test(new URL(streamUrl).pathname),custom:value.custom===true};
}
export function radioLibrary(value={}) {
  if(!Array.isArray(value.stations || []) || (value.stations || []).length>RADIO_LIMITS.stations)throw new Error(tr("Saved stations exceed 400 station limit"));
  const stations=(value.stations || []).map(radioStation),ids=new Set(stations.map(row=>row.uuid));if(ids.size!==stations.length)throw new Error(tr("Duplicate station identifiers"));
  const list=(key,limit)=>{const rows=value[key] || [];if(!Array.isArray(rows) || rows.length>limit || new Set(rows).size!==rows.length || rows.some(id=>!ids.has(id)))throw new Error(tr("Invalid favorite or recent station list"));return rows.slice();};
  return {stations,favorites:list('favorites',RADIO_LIMITS.favorites),recent:list('recent',RADIO_LIMITS.recent)};
}
export function mergeRadioLibraries(local,incoming) {local=radioLibrary(local);incoming=radioLibrary(incoming);const favorites=[...new Set([...local.favorites,...incoming.favorites])];if(favorites.length>RADIO_LIMITS.favorites)throw new Error(tr("Merged station favorites exceed 200 station limit"));const recent=[...new Set([...local.recent,...incoming.recent])].slice(0,RADIO_LIMITS.recent),rows=new Map([...incoming.stations,...local.stations].map(row=>[row.uuid,row])),pinned=new Set([...favorites,...recent]);const stations=[...[...pinned].map(id=>rows.get(id)),...[...rows.values()].filter(row=>!pinned.has(row.uuid))].slice(0,RADIO_LIMITS.stations);return radioLibrary({stations,favorites,recent});}
export function radioQuery(value){return {scope:['domestic','world','favorites','recent','qq'].includes(value?.scope)?value.scope:'domestic',query:typeof value?.query==='string'?value.query.slice(0,RADIO_LIMITS.query):''};}

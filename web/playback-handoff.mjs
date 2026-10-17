/* PlaybackHandoffSnapshot v1 compatibility with ArchiveTune Android.
 * ArchiveTune (2026), Rukamori and contributors. GPL-3.0. */
import {parseBilibiliId} from './bilibili-id.mjs';

export const HANDOFF_LIMITS=Object.freeze({tracks:40,bytes:131072,age:7*86400000,future:300000,duration:86400});
const object=value=>value && typeof value==='object' && !Array.isArray(value);
const text=(value,min,max)=>typeof value==='string' && value.length>=min && value.length<=max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const validRemote=(source,id)=>typeof id==='string' && (source==='bili'?!!parseBilibiliId(id):source==='qq'?/^[A-Za-z0-9]{5,32}$/.test(id):source==='netease'?/^[1-9]\d{0,17}$/.test(id):false);
export function handoffIdentity(id) {
  const match=typeof id==='string' && /^(qq|bili|netease):(track|video):([A-Za-z0-9_-]{1,128})$/.exec(id);
  return match && validRemote(match[1],match[3])?{source:match[1],remoteId:match[3],id:match[1]+'-'+match[3]}:null;
}
function artwork(value,source) {
  if(!value)return null;
  try {const url=new URL(value),hosts={qq:['y.gtimg.cn'],bili:['hdslb.com'],netease:['music.126.net']}[source];return url.protocol==='https:' && !url.username && !url.password && !url.hash && url.href.length<=2048 && hosts.some(host=>url.hostname===host || url.hostname.endsWith('.'+host))?url.href:null;}catch{return null;}
}
export function handoffTrack(value) {
  const source=value?.source,remote=value?.remoteId || (typeof value?.id==='string'?value.id.slice(String(source).length+1):'');
  if(!validRemote(source,remote) || value.id!==source+'-'+remote)return null;
  const duration=Number.isFinite(value.durationMs)?Math.floor(value.durationMs/1000):0;
  if(duration<0 || duration>HANDOFF_LIMITS.duration)return null;
  return {id:`${source}:${source==='bili'?'video':'track'}:${remote}`,title:String(value.title || 'Untitled track').slice(0,512),artist:String(value.artist || '').slice(0,512),duration,artwork:artwork(value.artworkUrl,source)};
}
/** Whitelist fields before upload. Credentials, URLs for media and local file data never travel. */
export function normalizeHandoff(value,{now=Date.now(),allowExpired=false}={}) {
  if(!object(value) || value.version!==undefined && value.version!==1 || !text(value.sessionId,1,64) || !text(value.deviceId,1,64) || !text(value.deviceName,1,100) || !Number.isSafeInteger(value.updatedAt) || value.updatedAt<0 || value.updatedAt>now+HANDOFF_LIMITS.future || !allowExpired && value.updatedAt<now-HANDOFF_LIMITS.age)throw new Error('Invalid handoff device, version, or timestamp');
  if(!Array.isArray(value.tracks) || value.tracks.length<1 || value.tracks.length>40 || !Number.isSafeInteger(value.index) || value.index<0 || value.index>=value.tracks.length || !Number.isSafeInteger(value.positionMs) || value.positionMs<0 || value.positionMs>86400000)throw new Error('Invalid handoff queue or position');
  const tracks=value.tracks.map(row=>{
    const identity=object(row) && handoffIdentity(row.id);
    if(!identity || !text(row.title,1,512) || !text(row.artist,0,512) || !Number.isSafeInteger(row.duration) || row.duration<0 || row.duration>86400 || row.artwork!==null && row.artwork!==undefined && (typeof row.artwork!=='string' || row.artwork.length>2048 || !row.artwork.startsWith('https://')))throw new Error('Handoff contains an invalid platform track');
    return {id:row.id,title:row.title,artist:row.artist,duration:row.duration,artwork:artwork(row.artwork,identity.source)};
  });
  if(tracks[value.index].duration>0 && value.positionMs>tracks[value.index].duration*1000)throw new Error('Handoff position exceeds track duration');
  return {version:1,sessionId:value.sessionId,deviceId:value.deviceId,deviceName:value.deviceName,updatedAt:value.updatedAt,tracks,index:value.index,positionMs:value.positionMs};
}
export function handoffExpired(snapshot,now=Date.now()) {return snapshot.updatedAt<now-HANDOFF_LIMITS.age;}
export function buildHandoff(queue,currentId,positionMs,{deviceId,deviceName,sessionId,currentIndex,now=Date.now()}={}) {
  if(currentIndex!==undefined && (!Number.isSafeInteger(currentIndex) || currentIndex<0 || currentIndex>=queue.length || queue[currentIndex]?.id!==currentId))throw new Error('Invalid current position in queue');
  const index=currentIndex===undefined?queue.findIndex(row=>row?.id===currentId):currentIndex,current=index>=0?handoffTrack(queue[index]):null;
  if(!current)throw new Error('This content cannot be handed off. Choose a platform track or video');
  const start=Math.max(0,index-10),included=queue.slice(start,start+40).map((row,offset)=>({index:start+offset,track:handoffTrack(row)})).filter(row=>row.track),selected=included.findIndex(row=>row.index===index);
  const position=Math.max(0,Math.floor(Number(positionMs) || 0)),duration=current.duration*1000;
  return normalizeHandoff({version:1,sessionId,deviceId,deviceName,updatedAt:now,tracks:included.map(row=>row.track),index:selected,positionMs:duration>0?Math.min(duration,position):Math.min(86400000,position)},{now});
}
export function handoffPlan(value,{now=Date.now()}={}) {
  const snapshot=normalizeHandoff(value,{now}),tracks=snapshot.tracks.map(row=>{const identity=handoffIdentity(row.id);return {...identity,title:row.title,artist:row.artist || 'Unknown artist',durationMs:row.duration*1000,artworkUrl:row.artwork || '',hasArtwork:!!row.artwork,size:0,type:'',cached:false,favorite:false,addedAt:now};}),ids=tracks.map(row=>row.id);
  const metadata=new Map(tracks.map(row=>[row.id,row]));metadata.set(tracks[snapshot.index].id,tracks[snapshot.index]);
  return {snapshot,tracks,ids,metadata:[...metadata.values()],index:snapshot.index,currentId:ids[snapshot.index],position:snapshot.positionMs};
}

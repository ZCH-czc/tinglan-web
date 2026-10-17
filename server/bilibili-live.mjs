/* Live protocol adapted from the Android BilibiliLiveRepository (GPL-3.0). */
import {PlatformError,cleanText,safeHttps} from './upstream.mjs';
import {publicImage} from './content-images.mjs';
import {validRoom,liveRoomFromLink} from '../web/live-room.mjs';
import {liveDescription} from '../web/live-description.mjs';
export {liveDescription};
export {validRoom,liveRoomFromLink as roomFromLink};

export const LIVE_HOSTS=['bilivideo.com','bilivideo.cn','akamaized.net','acgvideo.com','biliapi.net'];
export const liveUrl=value=>typeof value==='string' && (value.startsWith('https://') || value.startsWith('//'))?safeHttps(value,LIVE_HOSTS):null;
export const validQuality=qn=>Number.isSafeInteger(qn) && qn>=80 && qn<=30000;
const count=value=>Number.isSafeInteger(Number(value)) && Number(value)>=0?Number(value):0;
const liveId=value=>validRoom(value)?value:Number.isSafeInteger(value) && value>0?String(value):'';
export async function liveDetail(providers,id,session) {
  if(!validRoom(id))throw new PlatformError('invalid-request','Invalid live room ID',400);
  const root=await providers.biliLive('/xlive/web-room/v1/index/getH5InfoByRoom',{room_id:id},session);
  const info=root.data?.room_info,anchor=root.data?.anchor_info?.base_info;
  const roomId=liveId(info?.room_id),creatorId=liveId(info?.uid);
  if(!validRoom(roomId) || !validRoom(creatorId))throw new PlatformError('invalid-response','Incomplete live room profile');
  return {requestedId:id,roomId,creatorId,creatorName:cleanText(anchor?.uname || 'UP creator').slice(0,256),title:cleanText(info.title || 'Bilibili Live').slice(0,512),
    live:info.live_status===1,viewers:count(info.online),area:[info.parent_area_name,info.area_name].filter(Boolean).map(value=>cleanText(value)).join(' · ').slice(0,200),description:liveDescription(info.description),avatar:publicImage('bili',anchor?.face),image:publicImage('bili',info.cover || info.user_cover)};
}
export function parseLiveManifest(data) {
  const info=data?.playurl_info?.playurl,qualities=(info?.g_qn_desc || []).slice(0,20).filter(q=>validQuality(q.qn)).map(q=>({id:q.qn,label:cleanText(q.desc || String(q.qn)).slice(0,64)}));
  const streams=[];
  for(const protocol of (info?.stream || []).slice(0,8))if(protocol.protocol_name==='http_hls')for(const format of (protocol.format || []).slice(0,6))if(['ts','fmp4'].includes(format.format_name))for(const codec of (format.codec || []).slice(0,6)) {
    if(!['avc','hevc','av1'].includes(codec.codec_name) || !validQuality(codec.current_qn) || typeof codec.base_url!=='string')continue;
    const urls=(codec.url_info || []).slice(0,6).map(row=>liveUrl(String(row.host || '')+codec.base_url+String(row.extra || ''))).filter(Boolean).slice(0,5);
    const key=`${codec.current_qn}:${codec.codec_name}:${format.format_name}`;
    if(urls.length && !streams.some(row=>row.key===key))streams.push({key,quality:codec.current_qn,label:qualities.find(q=>q.id===codec.current_qn)?.label || String(codec.current_qn),codec:codec.codec_name,format:format.format_name,urls});
  }
  return {live:data?.live_status===1,qualities,streams};
}
export async function liveManifest(providers,id,quality,session) {
  if(!validRoom(id) || !validQuality(quality))throw new PlatformError('invalid-request','Invalid live parameters',400);
  const root=await providers.biliLive('/xlive/web-room/v2/index/getRoomPlayInfo',{room_id:id,protocol:'0,1',format:'0,1,2',codec:'0,1,2',qn:quality,platform:'web',ptype:'8',web_location:'444.8'},session,true);
  const data=parseLiveManifest(root.data);
  data.streams.sort((a,b)=>Math.abs(a.quality-quality)-Math.abs(b.quality-quality) || Number(a.codec!=='avc')-Number(b.codec!=='avc'));
  return {...data,streams:data.streams.slice(0,6)};
}

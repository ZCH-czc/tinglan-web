/* Playlist protocols ported from ArchiveTune's Android catalogs. GPL-3.0. */
import {PlatformError,cleanText} from './upstream.mjs';
import {mapQq,mapBili,mapNetease} from './providers.mjs';
import {publicImage} from './content-images.mjs';
import {validCollection} from '../web/collection-links.mjs';
const SIZE=20;
const count=value=>Number.isFinite(Number(value))?Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Math.floor(Number(value)))):0;
function result(source,id,page,title,owner,description,cover,songs,total,more,unavailable=0,warning='') {
  return {playlist:{source,id,title:cleanText(title) || 'Platform playlists',owner:cleanText(owner),description:cleanText(description),image:publicImage(source,cover)},songs:[...new Map(songs.map(row=>[row.id,row])).values()],page,total:count(total),more:!!more && page<500,unavailable,warning};
}
export async function collection(p,source,id,page,session) {
  if(!validCollection(source,id) || !Number.isSafeInteger(page) || page<1 || page>500)throw new PlatformError('invalid-request','Invalid playlist parameters',400);
  const offset=(page-1)*SIZE;
  if(source==='qq') {
    if(!Number.isSafeInteger(Number(id)))throw new PlatformError('invalid-request','Playlist identifier exceeds platform limits',400);
    const data=await p.qq('music.srfDissInfo.DissInfo','CgiGetDiss',{disstid:Number(id),dirid:0,tag:1,song_begin:offset,song_num:SIZE,userinfo:1,orderlist:1,onlysonglist:0},session),info=data.dissinfo || data.dirinfo || data;
    if(info.disstid && String(info.disstid)!==id)throw new PlatformError('invalid-response','The platform returned a different playlist identifier');
    const rows=(data.songlist || []).slice(0,SIZE),songs=rows.map(mapQq).filter(Boolean),total=count(data.total_song_num ?? info.songnum ?? offset+rows.length);
    return result(source,id,page,info.dissname || info.title,info.nick || info.host_nick || info.creator?.nick,info.desc,info.logo || info.listlogo || info.picurl || info.picurl2,songs,total,rows.length>0 && offset+rows.length<total,rows.length-songs.length);
  }
  if(source==='bili') {
    const season=id.startsWith('season_'),remote=season?id.slice(7):id;
    if(!season && !session?.cookies.bili)throw new PlatformError('sign-in','Connect your Bilibili account before opening collections',401);
    const data=(await p.bili(season?'/x/space/fav/season/list':'/x/v3/fav/resource/list',season?{season_id:remote,pn:page,ps:SIZE}:{media_id:remote,pn:page,ps:SIZE,keyword:'',order:'mtime',type:0,tid:0,platform:'web'},session)).data || {},info=data.info || {};
    const rows=(data.medias || []).slice(0,SIZE),songs=rows.map(row=>mapBili({...row,pic:row.cover || row.pic,owner:row.upper || row.owner})).filter(Boolean),total=count(info.media_count ?? info.count ?? offset+rows.length);
    const more=data.has_more!=null?(data.has_more===true || data.has_more===1 || data.has_more==='1'):offset+SIZE<total;
    return result(source,id,page,info.title,info.upper?.name,info.intro || info.description,info.cover || rows[0]?.cover,songs,total,rows.length>0 && more,rows.length-songs.length);
  }
  const root=await p.netease('/api/v6/playlist/detail',{id,n:10000,s:0},session),info=root.playlist;
  if(String(info?.id)!==id)throw new PlatformError('invalid-response','NetEase returned a different playlist identifier');
  const ids=(info.trackIds || []).slice(0,10000).map(row=>String(row.id)).filter(value=>/^[1-9]\d{0,18}$/.test(value)),selected=ids.slice(offset,offset+SIZE);
  let rows=[];
  if(selected.length) {
    const data=await p.netease('/api/v3/song/detail',{c:JSON.stringify(selected.map(value=>({id:value})))},session);
    const indexed=new Map((data.songs || []).map(row=>[String(row.id),row]));rows=selected.map(value=>indexed.get(value)).filter(Boolean);
  }
  const songs=rows.map(mapNetease).filter(Boolean),total=count(info.trackCount ?? ids.length);
  return result(source,id,page,info.name,info.creator?.nickname,info.description,info.coverImgUrl,songs,total,offset+SIZE<ids.length,selected.length-songs.length,total>10000?'Playlist exceeds local capacity. Browse up to the first 10000 items':'');
}

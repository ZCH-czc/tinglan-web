/* Artist protocols adapted from ArchiveTune's PlatformArtistRepository. GPL-3.0. */
import { PlatformError,cleanText,safeHttps } from './upstream.mjs';
import { ART_HOSTS,mapQq,mapBili,mapNetease } from './providers.mjs';
export function validCreator(source,id) {return source==='qq'?/^[A-Za-z0-9]{5,32}$/.test(id):['bili','netease'].includes(source)&&/^[1-9]\d{0,18}$/.test(id);}
export function qqAvatar(id) {return validCreator('qq',id)?`https://y.gtimg.cn/music/photo_new/T001R300x300M000${id}.jpg`:'';}
const count=value=>Number.isFinite(Number(value))?Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Math.floor(Number(value)))):0;
function profile(source,id,name,description,avatar,followers=0) {
  if(!name)throw new PlatformError('not-found','Artist profile unavailable',404);
  return {source,id,name:cleanText(name),description:cleanText(description),avatarUrl:safeHttps(avatar,ART_HOSTS[source]) || '',followers:count(followers)};
}
export async function creatorProfile(p,source,id,session) {
  if(!validCreator(source,id))throw new PlatformError('invalid-request','Invalid artist identifier',400);
  if(source==='bili') {
    const data=(await p.bili('/x/web-interface/card',{mid:id,photo:false},session)).data;const card=data?.card;
    if(String(card?.mid)!==id)throw new PlatformError('invalid-response','Artist profile identifier mismatch');
    return profile(source,id,card.name,card.sign,card.face,data.follower ?? card.fans);
  }
  if(source==='qq') {
    const data=await p.qq('music.musichallSinger.SingerInfoInter','GetSingerDetail',{singer_mids:[id],ex_singer:true,wiki_singer:false,group_singer:false,pic:true,photos:false},session,undefined,true);
    const singer=(data.singer_list || []).find(s=>s.basic_info?.singer_mid===id);
    if(!singer)throw new PlatformError('not-found','Singer profile unavailable',404);
    return profile(source,id,singer.basic_info.name || singer.basic_info.singer_name,singer.ex_info?.desc,singer.pic?.pic || qqAvatar(id));
  }
  const data=await p.netease(`/api/v1/artist/${id}`,{},session);const artist=data.artist;
  if(String(artist?.id)!==id)throw new PlatformError('invalid-response','Artist profile identifier mismatch');
  return profile(source,id,artist.name,artist.briefDesc,artist.picUrl || artist.img1v1Url);
}
export async function creatorSongs(p,source,id,page,session) {
  if(!validCreator(source,id) || !Number.isSafeInteger(page) || page<1 || page>100)throw new PlatformError('invalid-request','Invalid artist release pagination',400);
  if(source==='bili') {
    const data=(await p.bili('/x/space/wbi/arc/search',{mid:id,pn:page,ps:30,tid:0,order:'pubdate',platform:'web',web_location:'333.1387',order_avoided:true},session,true)).data;
    const rows=data?.list?.vlist || [];return {songs:rows.slice(0,30).map(row=>mapBili({...row,mid:id,duration:row.length || row.duration})).filter(Boolean),total:count(data?.page?.count),more:rows.length>0 && page*30<count(data?.page?.count)};
  }
  if(source==='qq') {
    const data=await p.qq('musichall.song_list_server','GetSingerSongList',{singerMid:id,order:1,num:30,begin:(page-1)*30},session);
    if(data.singerMid && data.singerMid!==id)throw new PlatformError('invalid-response','Artist track identifier mismatch');
    const rows=data.songList || [];return {songs:rows.slice(0,30).map(row=>mapQq(row.songInfo || row)).filter(Boolean),total:count(data.totalNum),more:rows.length>0 && page*30<count(data.totalNum)};
  }
  const data=await p.netease('/api/v1/artist/songs',{id,private_cloud:true,work_type:1,order:'hot',offset:(page-1)*30,limit:30},session);
  const rows=data.songs || [];return {songs:rows.slice(0,30).map(mapNetease).filter(Boolean),total:count(data.total),more:rows.length>0 && (data.more===true || page*30<count(data.total))};
}

export function mapCreator(source,row) {
  const id=String(source==='qq'?(row.singer_mid || row.singermid || row.mid || ''):source==='bili'?(row.mid || ''):(row.id || ''));
  if(!validCreator(source,id))return null;
  const name=source==='qq'?(row.singer_name || row.singername || row.name):source==='bili'?row.uname:row.name;
  if(!cleanText(name).trim())return null;
  return profile(source,id,name,row.sign || row.description || '',source==='qq'?qqAvatar(id):source==='bili'?row.upic:(row.picUrl || row.img1v1Url),row.fans || row.followers || 0);
}

/** Uses the existing Android artist protocols; challenges never fall through to another endpoint. */
export async function searchCreators(p,source,term,page,session) {
  if(!['qq','bili','netease'].includes(source) || !term.trim() || term.length>200 || !Number.isSafeInteger(page) || page<1 || page>100)throw new PlatformError('invalid-request','Invalid artist search parameters',400);
  let rows=[],total=0,more=false,warning='';
  if(source==='bili') {
    const data=(await p.bili('/x/web-interface/wbi/search/type',{keyword:term,page,page_size:20,search_type:'bili_user',order:0,user_type:0,platform:'pc'},session,true)).data || {};
    rows=data.result || [];total=count(data.numResults);more=rows.length>0 && page<count(data.numPages);
  } else if(source==='qq') {
    try {
      const data=await p.qq('music.search.SearchCgiService','DoSearchForQQMusicMobile',{searchid:String(Date.now()*1000),query:term,search_type:1,num_per_page:20,page_num:page,highlight:false,grp:true},session,undefined,true);
      const area=data.body?.singer || data.body?.item_singer || [];rows=Array.isArray(area)?area:(area.items || area.list || []);total=count(data.meta?.sum ?? area.total_num);more=rows.length>0 && Number(data.meta?.nextpage)>page;
    } catch(error) {
      if(!(error instanceof PlatformError) || error.code!=='unavailable' || page!==1)throw error;
    }
    if(page===1 && !rows.some(row=>mapCreator(source,row))) {
      const result=await p.net.json('qq','https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?'+new URLSearchParams({key:term,format:'json'}),{headers:p.headers('qq',session?.cookies.qq || '')},60_000,session?.id?`${session.id}:${session.generation || 0}`:'anonymous');
      if(result.code!==0)throw new PlatformError('unavailable','QQ Artist search unavailable');rows=result.data?.singer?.itemlist || [];total=rows.length;more=false;warning=rows.length?'Showing platform artist suggestions':'';
    }
  } else {
    const data=(await p.netease('/api/search/get',{s:term,type:100,limit:20,offset:(page-1)*20,total:true},session)).result || {};
    rows=data.artists || [];total=count(data.artistCount);more=rows.length>0 && page*20<total;
  }
  const creators=[...new Map(rows.slice(0,20).map(row=>mapCreator(source,row)).filter(Boolean).map(row=>[row.id,row])).values()];
  return {creators,total,more:more && page<100,warning};
}

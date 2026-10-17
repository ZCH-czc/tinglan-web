/* Video page/collection mapping follows the Android BilibiliVideoRepository. GPL-3.0. */
import {cleanText} from './upstream.mjs';
import {mapBili,mapBiliPart} from './providers.mjs';
import {loadBilibiliSegment} from './bilibili-segment.mjs';
import {parseBilibiliId} from '../web/bilibili-id.mjs';

export async function bilibiliContext(providers,track,session) {
  const {view,bvid,cid}=await loadBilibiliSegment(providers,track,session);
  const pages=(view.pages || []).slice(0,1000),seen=new Set(),parts=[];
  for(const [index,part] of pages.entries()) {
    const song=mapBiliPart(view,part,index);if(!song || seen.has(String(part.cid)))continue;seen.add(String(part.cid));
    parts.push({number:Number.isSafeInteger(part.page) && part.page>0?part.page:index+1,cid:String(part.cid),title:cleanText(part.part) || cleanText(view.title),song});
  }
  const season=view.ugc_season;let collection=null;
  if(/^[1-9]\d{0,18}$/.test(String(season?.id || ''))) {
    const songs=new Map();
    for(const section of (season.sections || []).slice(0,100))for(const episode of (section.episodes || []).slice(0,2000)) {
      if(songs.size>=2000)break;
      const arc=episode.arc || episode,remote=episode.bvid || arc.bvid;
      if(!parseBilibiliId(remote) || remote.includes('_cid_'))continue;
      const song=mapBili({...arc,bvid:remote,title:episode.title || arc.title,owner:arc.owner || view.owner,pic:arc.pic || view.pic});
      if(song?.title)songs.set(song.id,song);
    }
    const total=Math.max(songs.size,Number.isSafeInteger(season.ep_count) && season.ep_count>=0?season.ep_count:0);
    collection={id:'season_'+season.id,title:cleanText(season.title) || 'Video collection',total,songs:[...songs.values()],partial:total>songs.size};
  }
  return {bvid,title:cleanText(view.title),cid:String(cid),parts,collection,warning:(view.pages?.length || 0)>1000?'Too many video parts. Showing the first 1000 P':''};
}

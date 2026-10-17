/* Dynamic and following protocols ported from ArchiveTune's BilibiliActivity,
 * BilibiliFeedRepository and BilibiliFollowingsRepository. GPL-3.0. */
import {PlatformError,cleanText} from './upstream.mjs';
import {publicImage} from './content-images.mjs';
import {mapBili} from './providers.mjs';
import {validCreator} from './creators.mjs';

const yes=value=>value===true || value===1 || value==='1';
const count=value=>Number.isFinite(Number(value))?Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Math.floor(Number(value)))):0;
const digits=(value,size)=>typeof value==='string' && new RegExp(`^[1-9][0-9]{0,${size-1}}$`).test(value) || Number.isSafeInteger(value) && value>0 && String(value).length<=size;
export const validDynamicId=value=>typeof value==='string' && /^[1-9][0-9]{0,23}$/.test(value);
const image=url=>publicImage('bili',url);
const rows=(value,limit)=>Array.isArray(value)?value.slice(0,limit):[];
function seconds(value) {
  if(typeof value!=='string' || !/^\d{1,5}(?::\d{1,2}){1,2}$/.test(value))return 0;
  const parts=value.split(':').map(Number);if(parts.slice(1).some(n=>n>59))return 0;
  const result=parts.reduce((a,b)=>a*60+b,0);return result>0 && result<=86400?result:0;
}
/** IDs remain strings: Bilibili dynamic IDs routinely exceed JS's safe integer range. */
export function mapActivity(row,depth=0) {
  if(!row || typeof row!=='object' || !validDynamicId(row.id_str) || ['DYNAMIC_TYPE_AD','DYNAMIC_TYPE_NONE'].includes(row.type) || row.modules?.module_ad)return null;
  const modules=row.modules || {},author=modules.module_author || {},dyn=modules.module_dynamic || {},major=dyn.major || {},opus=major.opus || {};
  const authorId=digits(author.mid,19)?String(author.mid):'',authorName=cleanText(author.name,256).trim();
  if(!validCreator('bili',authorId) || !authorName)return null;
  const desc=dyn.desc || opus.summary || {},nodes=rows(desc.rich_text_nodes,300),text=cleanText(desc.text ?? nodes.map(n=>n?.orig_text || n?.text || '').join(''),10000);
  const emotes=[...new Map(nodes.map(n=>({token:cleanText(n?.orig_text || n?.text,128),image:image(n?.emoji?.webp_url || n?.emoji?.gif_url || n?.emoji?.icon_url)})).filter(n=>n.token && n.image).map(n=>[n.token,n])).values()].slice(0,100);
  const archive=major.archive || {},mapped=mapBili({bvid:archive.bvid,title:archive.title,pic:archive.cover,duration:seconds(archive.duration_text),owner:{mid:authorId,name:authorName}}),song=mapped?.title.trim()?mapped:null;
  const pictures=[...new Map([...rows(opus.pics,9).map(p=>image(p?.url || p?.src)),...rows(major.draw?.items,9).map(p=>image(p?.src)),...rows(major.article?.covers,9).map(image)].filter(Boolean).map(p=>[p.key,p])).values()].slice(0,9);
  let live=null;const content=major.live_rcmd?.content;
  if(typeof content==='string' && content.length<=8000){try{live=JSON.parse(content)?.live_play_info}catch{/* Malformed recommendations never become live routes. */}}
  const liveRoomId=digits(live?.room_id,18)?String(live.room_id):'';
  const original=depth===0?mapActivity(row.orig,1):null,forward=row.type==='DYNAMIC_TYPE_FORWARD';
  const type=forward?'forward':song?'video':major.article?'article':liveRoomId?'live':pictures.length?'pictures':text.trim()?'text':'other';
  if(type==='other' && !cleanText(opus.title))return null;
  const basic=row.basic || {},commentType=Number(basic.comment_type),commentTarget=validDynamicId(basic.comment_id_str) && [1,11,12,17].includes(commentType)?{oid:basic.comment_id_str,type:commentType}:null;
  return {id:row.id_str,type,authorId,author:authorName,avatar:image(author.face),at:count(author.pub_ts),atLabel:cleanText(author.pub_time,128),text,emotes,pictures,title:cleanText(opus.title || major.article?.title || live?.title,512),song,original,originalUnavailable:forward && !original,
    comments:count(modules.module_stat?.comment?.count),likes:count(modules.module_stat?.like?.count),reposts:count(modules.module_stat?.forward?.count),liveRoomId,commentTarget,pinned:modules.module_tag?.text==='\u7f6e\u9876' || yes(row.is_top)};
}
export function activitySongs(items) {return [...new Map(items.flatMap(row=>[row.song,row.original?.song]).filter(Boolean).map(song=>[song.id,song])).values()];}
export function activityPage(data,cursor='') {
  if(!Array.isArray(data?.items))throw new PlatformError('invalid-response','Feed unavailable');
  const items=[...new Map(data.items.slice(0,100).map(row=>mapActivity(row)).filter(Boolean).map(row=>[row.id,row])).values()];
  const offset=typeof data.offset==='string'?data.offset:'';
  return {items,next:yes(data.has_more) && offset && offset.length<=512 && !/[\r\n]/.test(offset) && offset!==cursor?offset:'',notice:!items.length && data.items.length?'The platform returned no displayable posts on this page':''};
}
export async function activityFeed(p,{scope='author',id='',cursor=''}={},session) {
  if(!['author','following'].includes(scope) || scope==='author' && !validCreator('bili',id) || typeof cursor!=='string' || cursor.length>512 || /[\r\n]/.test(cursor))throw new PlatformError('invalid-request','Invalid feed parameters',400);
  if(scope==='following' && !session?.cookies?.bili)throw new PlatformError('sign-in','Connect your Bilibili account to view your feed',401);
  const data=(await p.bili(scope==='author'?'/x/polymer/web-dynamic/v1/feed/space':'/x/polymer/web-dynamic/v1/feed/all',{...(scope==='author'?{host_mid:id}:{type:'all'}),features:'itemOpusStyle',timezone_offset:-480,...(cursor?{offset:cursor}:{})},session)).data;
  return activityPage(data,cursor);
}
export async function activityDetail(p,id,session) {
  if(!validDynamicId(id))throw new PlatformError('invalid-request','Invalid post identifier',400);
  const data=(await p.bili('/x/polymer/web-dynamic/v1/detail',{id,features:'itemOpusStyle',timezone_offset:-480,web_location:'333.1330'},session)).data;
  const activity=mapActivity(data?.item);
  if(!activity || activity.id!==id)throw new PlatformError('not-found','Post unavailable. It may be deleted or access-restricted',404);
  return activity;
}
export async function followedCreators(p,page=1,session) {
  if(!Number.isSafeInteger(page) || page<1 || page>500)throw new PlatformError('invalid-request','Invalid following-list page',400);
  const uid=String(session?.cookies?.bili || '').split(';').map(p=>p.trim()).find(p=>p.startsWith('DedeUserID='))?.slice(11);
  if(!validCreator('bili',uid || ''))throw new PlatformError('sign-in','Connect an account including your own user identifier for Bilibili account',401);
  const data=(await p.bili('/x/relation/followings',{vmid:uid,pn:page,ps:50,order:'desc'},session)).data;
  if(!Array.isArray(data?.list))throw new PlatformError('invalid-response','Following list unavailable');
  const items=[...new Map(data.list.slice(0,50).map(row=>{
    const id=digits(row?.mid,19)?String(row.mid):'',name=cleanText(row?.uname,256).trim();if(!validCreator('bili',id) || !name)return null;
    return {id,source:'bili',name,description:cleanText(row.sign),image:image(row.face),followers:0};
  }).filter(Boolean).map(row=>[row.id,row])).values()];
  const total=data.total==null?null:count(data.total),more=data.list.length>=50 && page<500 && (total==null || page*50<total);
  return {items,total:total ?? 0,next:more?String(page+1):'',notice:''};
}

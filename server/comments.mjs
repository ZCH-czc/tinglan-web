/* Comment protocols and mappings ported from ArchiveTune's Android repositories. GPL-3.0. */
import {PlatformError,cleanText} from './upstream.mjs';
import {publicImage} from './content-images.mjs';
import {parseBilibiliId} from '../web/bilibili-id.mjs';

const SIZE=20;
const number=value=>Number.isFinite(Number(value))?Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Math.floor(Number(value)))):0;
const idValue=value=>typeof value==='number' && !Number.isSafeInteger(value)?'':/^[A-Za-z0-9_.:!*~-]{1,512}$/.test(String(value ?? ''))?String(value):'';
const yes=value=>value===true || value===1 || value==='true' || value==='1';
export function commentCursor(raw='') {
  if(!raw)return {page:1};
  if(typeof raw!=='string' || raw.length>2048)throw new PlatformError('invalid-request','Invalid comment pagination',400);
  let value;try{value=JSON.parse(raw);}catch{throw new PlatformError('invalid-request','Invalid comment pagination',400);}
  if(!value || typeof value!=='object' || Array.isArray(value))throw new PlatformError('invalid-request','Invalid comment pagination',400);
  const page=value.page ?? 1;
  if(!Number.isSafeInteger(page) || page<1 || page>500)throw new PlatformError('invalid-request','Invalid comment pagination',400);
  for(const field of ['seq','rank','offset','ver'])if(value[field]!=null && (typeof value[field]!=='string' || value[field].length>512 || /[\r\n]/.test(value[field])))throw new PlatformError('invalid-request','Invalid comment pagination',400);
  return {page,seq:value.seq || '',rank:value.rank || '',offset:value.offset || '',ver:value.ver || '0',total:number(value.total),legacy:value.legacy===true};
}
function image(source,address){return publicImage(source,address);}
const commentText=value=>cleanText(value,10000);
function quote(author,text){return commentText(text)?{author:cleanText(author),text:commentText(text)}:null;}
export function mapComment(source,row,depth=0,owner='') {
  const id=idValue(source==='bili'?(row.rpid_str || row.rpid):source==='qq'?(row.CmId || row.commentid):row.commentId);if(!id)return null;
  const user=source==='bili'?(row.member || {}):source==='netease'?(row.user || {}):row;
  const parent=source==='qq'?(row.ParentComment || row.RepliedComments?.[0]):source==='netease'?row.beReplied?.[0]:null;
  const rawText=source==='bili'?row.content?.message:source==='qq'?(row.Content ?? row.rootcommentcontent):row.content;
  const avatar=source==='bili'?user.avatar:source==='qq'?(row.Avatar || row.avatarurl):user.avatarUrl;
  const authorId=String(source==='bili'?(user.mid || ''):source==='qq'?(row.Uin || row.uin || ''):(user.userId || ''));
  const badges=[];
  if(source==='bili') {
    if(authorId===owner && owner)badges.push('Creator');const level=number(user.level_info?.current_level);if(level>=1 && level<=6)badges.push('LV'+level);
    if(yes(user.is_senior_member))badges.push('Veteran member');if(yes(user.vip?.vipStatus || user.vip?.vip_status))badges.push(cleanText(user.vip?.label?.text || 'Premium member'));
  }else if(source==='qq'){if(row.VipIcon || row.vipicon)badges.push('Member');if(row.IdentityPic)badges.push('Verified');}
  else {if(number(user.vipType)>0)badges.push('Member');if(number(user.userType)>0)badges.push('Verified');}
  const emotes=source==='bili'?Object.entries(row.content?.emote || {}).slice(0,40).map(([token,item])=>({token:cleanText(token).slice(0,60),image:image(source,item?.url)})).filter(item=>item.token && item.image):[];
  const pictures=source==='bili'?(row.content?.pictures || []).slice(0,9).map(item=>image(source,item.img_src)):source==='qq'?[image(source,row.Pic),image(source,row.EmoPic)]:[...(row.picList || []).slice(0,9).map(item=>image(source,item.url)),image(source,row.contentPicUrl || row.expressionUrl)];
  return {id,source,author:cleanText(source==='bili'?user.uname:source==='qq'?(row.Nick || row.nick):user.nickname) || 'Music listener',authorId,text:commentText(rawText),avatar:image(source,avatar),
    likes:number(source==='bili'?row.like:source==='qq'?(row.PraiseNum ?? row.praisenum):row.likedCount),
    at:number(source==='bili'?row.ctime:source==='qq'?(row.PubTime || row.time):Math.floor(number(row.time)/1000)),location:cleanText(row.reply_control?.location || row.ipLocation?.location),badges:badges.slice(0,5),
    replyCount:number(source==='bili'?(row.rcount ?? row.count):source==='qq'?(row.ReplyCnt ?? row.RplCnt ?? row.replynum):(row.replyCount ?? row.showFloorComment?.replyCount ?? row.beRepliedCount)),
    pinned:yes(row.IsStick),authorLiked:yes(row.up_action?.like) || yes(row.AuthorPraise),
    quote:parent?quote(source==='qq'?parent.Nick:parent.user?.nickname,source==='qq'?parent.Content:parent.content):null,
    previews:depth===0?(source==='bili'?(row.replies || []):source==='qq'?(row.SubComments || []):[]).slice(0,3).map(child=>mapComment(source,child,1,owner)).filter(Boolean):[],
    emotes,pictures:pictures.filter(Boolean).slice(0,9),seq:cleanText(source==='qq'?row.SeqNo:row.time).slice(0,512),rank:cleanText(row.RankScore).slice(0,512)};
}
function page(items,total,cursor,notice='') {return {items:[...new Map(items.map(row=>[row.id,row])).values()],total:number(total),next:cursor?JSON.stringify(cursor):'',notice:cleanText(notice)};}
function qqPage(data,current) {
  const list=data.CommentList;if(!list)throw new PlatformError('invalid-response','QQ Music comments unavailable');
  const items=(list.Comments || []).slice(0,SIZE).map(row=>mapComment('qq',row)).filter(Boolean),last=items.at(-1),total=number(data.TotalCmNum || list.Total);
  const next=yes(list.HasMore) && last && current<500?{page:current+1,seq:last.seq,rank:last.rank,total,ver:String(data.TotalVer || '0').slice(0,512)}:null;
  return page(items,total,next,data.CommentTip || (!items.length && total>0?'Replies unavailable. Connect an account or refresh to retry':''));
}
export async function comments(p,track,{order='hot',cursor='',root=''}={},session) {
  if(!['hot','new'].includes(order) || (root && !idValue(root)))throw new PlatformError('invalid-request','Invalid comment parameters',400);
  const token=commentCursor(cursor),current=token.page;
  if(track.source==='bili') {
    const id=parseBilibiliId(track.remoteId);if(!id)throw new PlatformError('invalid-request','Invalid video identifier',400);
    const view=(await p.bili('/x/web-interface/view',{bvid:id.bvid},session)).data;
    const aid=String(view?.aid || '');if(!/^[1-9]\d{0,18}$/.test(aid))throw new PlatformError('invalid-response','Video comment identifier unavailable');
    return bilibiliReplies(p,{oid:aid,type:1,owner:String(view?.owner?.mid || '')},{order,cursor,root},session);
  }
  if(track.source==='qq') {
    if(root) return qqPage(await p.qq('music.globalComment.CommentRead','GetReplyCommentList',{RootCmId:root,PageSize:SIZE,PageNum:current-1,RankType:0,PicEnable:1,LastCommentSeqNo:token.seq,LastRankScore:token.rank},session),current);
    let songId=track.songId;
    if(!Number.isSafeInteger(songId) || songId<=0) {const data=await p.qq('music.pf_song_detail_svr','get_song_detail',{song_mid:track.remoteId},session);if(data.track_info?.mid!==track.remoteId)throw new PlatformError('invalid-response','Track comment identifier mismatch');songId=Number(data.track_info.id);}
    if(!Number.isSafeInteger(songId) || songId<=0)throw new PlatformError('invalid-response','Track comment identifier unavailable');
    if(!token.legacy) {
      try {return qqPage(await p.qq('music.globalComment.CommentRead',order==='hot'?'GetHotCommentList':'GetNewCommentList',{BizType:1,BizId:String(songId),PageSize:SIZE,PageNum:current-1,LastCommentSeqNo:token.seq,PicEnable:1,...(order==='hot'?{HotType:1,WithAirborne:0}:{WithHot:0,FromCommentId:'',LastTotal:token.total,LastTotalVer:token.ver})},session),current);}
      catch(error){if(!(error instanceof PlatformError) || error.code!=='unavailable')throw error;}
    }
    const data=await p.net.json('qq','https://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg?'+new URLSearchParams({biztype:1,topid:songId,cmd:order==='hot'?6:8,pagenum:current-1,pagesize:SIZE,format:'json'}),{headers:p.headers('qq',session?.cookies.qq || '')},60_000,session?.id?`${session.id}:${session.generation || 0}`:'anonymous');
    if(data.code && data.code!==0)throw new PlatformError('unavailable','QQ Music comments unavailable');
    const section=data[order==='hot'?'hot_comment':'comment'];if(!section)throw new PlatformError('invalid-response','Comment content unavailable');
    const items=(section.commentlist || []).slice(0,SIZE).map(row=>mapComment('qq',row)).filter(Boolean),total=number(section.commenttotal);
    return page(items,total,items.length===SIZE && current<500 && current*SIZE<total?{page:current+1,legacy:true}:null);
  }
  if(track.source!=='netease')throw new PlatformError('invalid-request','This track does not support platform comments',400);
  const threadId='R_SO_4_'+track.remoteId;
  const data=(await p.netease(root?'/api/resource/comment/floor/get':'/api/v2/resource/comments',root?{parentCommentId:root,threadId,time:token.offset || '-1',limit:SIZE}:{threadId,pageNo:current,pageSize:SIZE,showInner:true,sortType:order==='hot'?2:3,cursor:order==='hot'?`normalHot#${(current-1)*SIZE}`:token.offset || '0'},session)).data || {};
  const raw=[...(root && current===1 && Array.isArray(data.bestComments)?data.bestComments.slice(0,3):[]),...(data.comments || []).slice(0,SIZE)];
  const items=[...new Map(raw.map(row=>mapComment('netease',row)).filter(Boolean).map(row=>[row.id,row])).values()],offset=String((root?data.time:data.cursor) ?? items.at(-1)?.seq ?? '').slice(0,512);
  const more=yes(data.hasMore) && items.length>0 && current<500 && (!root || offset!==token.offset);
  return page(items,data.totalCount,more?{page:current+1,offset}:null,!items.length && number(data.totalCount)>0?'Replies unavailable. Refresh to retry':'');
}

/** The caller resolves the platform's comment target; a dynamic ID is never used as an oid. */
export async function bilibiliReplies(p,{oid,type,owner=''},{order='hot',cursor='',root=''}={},session) {
  if(!/^[1-9][0-9]{0,23}$/.test(oid || '') || ![1,11,12,17].includes(type) || !['hot','new'].includes(order) || root && !idValue(root))throw new PlatformError('invalid-request','Invalid comment entry parameters',400);
  const current=commentCursor(cursor).page;
  const data=(await p.bili(root?'/x/v2/reply/reply':'/x/v2/reply',{type,oid,ps:SIZE,pn:current,sort:root || order==='hot'?1:0,...(root?{root}:{})},session)).data || {};
  const normal=(Array.isArray(data.replies)?data.replies:[]).slice(0,SIZE).map(row=>mapComment('bili',row,0,owner)).filter(Boolean);
  const pinned=!root && current===1?[...(Array.isArray(data.top_replies)?data.top_replies:[]).slice(0,4),...(data.upper?.top?[data.upper.top]:[])].map(row=>mapComment('bili',row,0,owner)).filter(Boolean).map(row=>({...row,pinned:true})):[];
  const total=number(data.page?.count ?? data.cursor?.all_count),size=Math.min(50,number(data.page?.size) || SIZE),more=normal.length>0 && current<500 && (root?current*size<total:normal.length===SIZE && current*SIZE<total);
  const parent=root && data.root?mapComment('bili',data.root,0,owner):null;
  if(parent && parent.id!==root)throw new PlatformError('invalid-response','The platform returned a different root comment identifier');
  return {...page([...pinned,...normal.filter(row=>!root || row.id!==root)],total,more?{page:current+1}:null,!more && current*SIZE<total?'The platform returned only some comments. Change sort order or refresh':''),...(parent?{parent}:{})};
}

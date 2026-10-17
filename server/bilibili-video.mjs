import { PlatformError,cleanText,safeHttps } from './upstream.mjs';
import {loadBilibiliSegment} from './bilibili-segment.mjs';
export const BILI_QUALITIES=[16,32,64,74,80,112,116,120,125,126,127];
const hosts=['bilivideo.com','bilivideo.cn','akamaized.net','bilibili.com'];
const rate=value=>{const [a,b]=String(value || 30).split('/').map(Number);return Math.max(1,Math.min(120,b?a/b:a || 30));};
export function mapVideoStreams(data) {
  const labels=new Map((data.accept_quality || []).map((id,i)=>[id,cleanText(data.accept_description?.[i])]));
  return (data.dash?.video || []).slice(0,40).flatMap((row,i)=>{
    const urls=[row.baseUrl || row.base_url,...(row.backupUrl || row.backup_url || [])].map(url=>safeHttps(url,hosts)).filter(Boolean).slice(0,2);
    const codec=String(row.codecs || ''),width=Number(row.width),height=Number(row.height),quality=Number(row.id);
    if(!urls.length || !/^[A-Za-z0-9.,_-]{1,100}$/.test(codec) || !BILI_QUALITIES.includes(quality) || !Number.isFinite(width) || !Number.isFinite(height) || width<1 || height<1 || width>8192 || height>8192)return [];
    return [{key:`${quality}-${row.codecid || codec}-${i}`,quality,label:labels.get(quality) || `${height}P`,codec,width,height,frameRate:rate(row.frameRate || row.frame_rate),bandwidth:Math.max(1,Number(row.bandwidth) || 1),urls,type:'video/mp4'}];
  });
}
export async function biliVideo(providers,track,quality,session) {
  const {view,bvid,cid,part}=await loadBilibiliSegment(providers,track,session);
  const root=await providers.bili('/x/player/wbi/playurl',{bvid,cid,qn:quality,fnval:4048,fnver:0,fourk:1},session,true);
  const streams=mapVideoStreams(root.data || {});if(!streams.length)throw new PlatformError('rights','No playable video provided. Check sign-in and content access',401);
  return {cid,streams,durationMs:Math.floor((root.data?.dash?.duration || 0)*1000),title:cleanText(part.part || view.title),creatorId:String(view.owner?.mid || '')};
}
const entity=text=>text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi,(_,name)=>{
  name=name.toLowerCase();
  const simple={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};if(simple[name])return simple[name];const code=name.startsWith('#x')?parseInt(name.slice(2),16):Number(name.slice(1));return code>0 && code<=0x10ffff && !(code>=0xd800 && code<=0xdfff)?String.fromCodePoint(code):'';
});
export function parseDanmaku(xml) {
  const items=[];let match;const pattern=/<d\s+[^>]*p=["']([^"']+)["'][^>]*>([\s\S]*?)<\/d>/g;
  while((match=pattern.exec(xml)) && items.length<4000){const [at,mode,,color]=match[1].split(',').map(Number);if(!Number.isFinite(at) || at<0 || at>86400 || ![1,4,5].includes(mode))continue;
    const text=entity(match[2].replace(/<[^>]*>/g,'')).trim().slice(0,120);if(!text)continue;
    items.push({at:Math.floor(at*1000),mode,color:Number.isInteger(color) && color>=0 && color<=0xffffff?color:0xffffff,text});
  }
  return items.sort((a,b)=>a.at-b.at);
}
export async function biliDanmaku(providers,track,session) {
  const {cid}=await loadBilibiliSegment(providers,track,session);
  const xml=await providers.net.text('bili',`https://comment.bilibili.com/${cid}.xml`,{headers:providers.headers('bili')},300_000,session?.id?`${session.id}:${session.generation || 0}`:'anonymous');
  return {cid,items:parseDanmaku(xml)};
}

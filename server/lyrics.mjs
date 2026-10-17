/* Matching policy ported from ArchiveTune's KugouLyricsMatcher.
 * ArchiveTune (2026), Rukamori and contributors. GPL-3.0; original notices retained. */
import { PlatformError } from './upstream.mjs';
const normal=value=>String(value || '').normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]/gu,'');
const title=value=>normal(String(value).replace(/[(（](?:live|live|instrumental|instrumental|remix|acoustic|cover|cover)[^)）]*[)）]/gi,'').replace(/[【\[](?:hi-res|Lossless|High quality|High quality|4k|1080p)[^】\]]*[】\]]/gi,''));
const artists=value=>new Set(String(value || '').split(/\s*(?:、|,|，|&|\/|;|；| feat\.? | ft\.? )\s*/i).map(normal).filter(s=>s && !['Unknown','Unknown artist','Unknown artist','unknown','bilibili','qq Music','Local music'].includes(s)));
const versions=value=>[/\blive\b|live/i,/\binstrumental\b|instrumental/i,/\bremix\b/i,/\bacoustic\b/i,/\bcover\b|cover/i].map(re=>re.test(value)).join('|');
export function lyricMatch(track,candidate) {
  const expected=title(track.title),actual=title(candidate.song);
  if(!expected || expected!==actual || versions(track.title)!==versions(candidate.song))return null;
  const a=artists(track.artist),b=artists(candidate.singer);
  if(!a.size || !b.size || ![...a].some(v=>b.has(v)))return null;
  const delta=Math.abs(candidate.duration-Number(track.durationMs || 0));
  if(track.durationMs>0 && (!Number.isFinite(candidate.duration) || candidate.duration<=0 || delta>8000))return null;
  return 100+([...a].every(v=>b.has(v)) && a.size===b.size?20:0)-(track.durationMs>0?Math.floor(delta/1000):0);
}
export function normalizeLrc(content) {
  return String(content).replace(/^\uFEFF/,'').replace(/&apos;/g,"'").replace(/&quot;/g,'"').replace(/&amp;/g,'&').split(/\r?\n/).map(s=>s.trim()).filter(s=>/^(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+.*$/.test(s)).slice(0,4000).join('\n').slice(0,200_000);
}
export async function kugouLyrics(net,track,headers) {
  const keyword=`${track.title.slice(0,200)} - ${track.artist.slice(0,200)}`;
  const signal=AbortSignal.timeout(9000),options={headers,signal};let lastError;
  const failed=error=>{if(signal.aborted)throw new PlatformError('timeout','Kugou lyrics matching timed out. Retry later',504);if(['verification','cooldown','sign-in'].includes(error.code))throw error;lastError=error;};
  let matches=[];
  try {
    const search=await net.json('kugou','https://mobileservice.kugou.com/api/v3/search/song?'+new URLSearchParams({version:9108,plat:0,pagesize:8,showtype:0,keyword}),options,300_000);
    matches=(search.data?.info || []).slice(0,8).map(s=>({row:s,score:lyricMatch(track,{song:s.songname,singer:s.singername,duration:Number(s.duration)*1000})})).filter(s=>s.score!==null && /^[a-fA-F0-9]{32}$/.test(s.row.hash || '')).sort((a,b)=>b.score-a.score).slice(0,3);
  }catch(error){failed(error)}
  const candidates=new Map();
  const collect=(data,song)=>{
    for(const c of (data.candidates || []).slice(0,30)) {
      const score=lyricMatch(track,{song:c.song || song?.songname,singer:c.singer || song?.singername,duration:Number(c.duration)});
      if(score!==null && /^\d{1,20}$/.test(String(c.id)) && /^[A-Za-z0-9_-]{1,256}$/.test(c.accesskey || ''))candidates.set(String(c.id),{row:c,score});
    }
  };
  for(const match of matches) {
    try {collect(await net.json('kugou','https://lyrics.kugou.com/search?'+new URLSearchParams({ver:1,man:'yes',client:'pc',hash:match.row.hash}),options,300_000),match.row);if(candidates.size)break;}
    catch(error){failed(error)}
  }
  if(!candidates.size)try {
    collect(await net.json('kugou','https://lyrics.kugou.com/search?'+new URLSearchParams({ver:1,man:'yes',client:'pc',keyword,...(track.durationMs>0?{duration:track.durationMs}:{})}),options,300_000));
  }catch(error){failed(error)}
  for(const {row:candidate} of [...candidates.values()].sort((a,b)=>b.score-a.score).slice(0,3)) {
    try {
      const result=await net.json('kugou','https://lyrics.kugou.com/download?'+new URLSearchParams({fmt:'lrc',charset:'utf8',client:'pc',ver:1,id:candidate.id,accesskey:candidate.accesskey}),options,300_000);
      if(typeof result.content!=='string' || result.content.length>2_097_152)throw new PlatformError('invalid-response','Unable to read lyrics data');
      const text=normalizeLrc(Buffer.from(result.content,'base64').toString('utf8'));if(text)return {text,source:'kugou'};
    }catch(error){failed(error)}
  }
  if(lastError)throw lastError;
  return {text:'',source:'kugou'};
}

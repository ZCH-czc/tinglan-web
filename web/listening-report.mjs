import {normalizeListeningHistory,listeningBounds,listeningFilter} from './listening-data.mjs';

const dayKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const groupKey=(at,period)=>{const d=new Date(at);return period==='day'?String(d.getHours()):period==='year'?String(d.getMonth()):period==='all'?String(d.getFullYear()):dayKey(d);};
export function listeningReport(input) {
  const records=normalizeListeningHistory(input.records),filter=listeningFilter(input.filter),bounds=listeningBounds(filter,input.now),songs=new Map(),artists=new Map(),albums=new Map(),days=new Set(),hours=Array(24).fill(0),chart=new Map();let totalMs=0,plays=0;
  const add=(map,key,label,row,ms)=>{const old=map.get(key)||{key,label,songId:row.songId,source:row.source,creatorId:row.creatorId,creatorName:row.creatorName,totalMs:0,plays:0};old.totalMs+=ms;++old.plays;map.set(key,old);};
  for(const row of records) {
    let ms=0;
    for(const [start,length] of row.segments) {
      let at=Math.max(start,bounds.start),end=Math.min(start+length,bounds.end);
      while(at<end){const d=new Date(at),next=new Date(at);next.setMinutes(60,0,0);const until=Math.min(end,Math.max(at+1,+next)),part=until-at;ms+=part;hours[d.getHours()]+=part;days.add(dayKey(d));const key=groupKey(at,filter.period);chart.set(key,(chart.get(key)||0)+part);at=until;}
    }
    if(ms<=0)continue;totalMs+=ms;++plays;add(songs,row.songId,row.title,row,ms);add(artists,`${row.source}:${row.creatorId || row.artist.normalize('NFKC').toLowerCase()}`,row.creatorName || row.artist,row,ms);if(row.album)add(albums,`${row.source}:${row.album.normalize('NFKC').toLowerCase()}`,row.album,row,ms);
  }
  const ranked=map=>[...map.values()].sort((a,b)=>b.totalMs-a.totalMs || b.plays-a.plays || a.key.localeCompare(b.key)).slice(0,50);
  const points=[];
  if(filter.period==='day')for(let i=0;i<24;i++)points.push({label:String(i),value:chart.get(String(i))||0});
  else if(filter.period==='year')for(let i=0;i<12;i++)points.push({label:String(i+1),value:chart.get(String(i))||0});
  else if(filter.period==='all')for(const [key,value] of [...chart].sort((a,b)=>a[0].localeCompare(b[0])).slice(-50))points.push({label:key,value});
  else for(let at=new Date(bounds.start);+at<bounds.end;at.setDate(at.getDate()+1))points.push({label:String(at.getDate()),value:chart.get(dayKey(at))||0});
  return {...bounds,totalMs,plays,songCount:songs.size,artistCount:artists.size,days:days.size,averageMs:totalMs/Math.max(1,days.size),points,hours,songs:ranked(songs),artists:ranked(artists),albums:ranked(albums)};
}

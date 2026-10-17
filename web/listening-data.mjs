import {tr,currentLanguage} from './i18n.mjs';
import {validId} from './library-data.mjs';

export const LISTENING_LIMITS=Object.freeze({sessions:10000,segments:128,threshold:30000,span:86400000,payloadBytes:64*1024*1024,observationGap:120000});
const text=(value,limit=2000)=>{if(typeof value!=='string' || value.length>limit)throw new Error(tr("Invalid listening statistics text"));return value;};
export function normalizeListening(value) {
  if(!value || !validId(value.id) || !validId(value.songId) || !Number.isSafeInteger(value.startedAt) || value.startedAt<0 || value.startedAt>8640000000000000-LISTENING_LIMITS.span || !Array.isArray(value.segments) || !value.segments.length || value.segments.length>LISTENING_LIMITS.segments)throw new Error(tr("Invalid listening record"));
  let end=value.startedAt,totalMs=0;
  const segments=value.segments.map(row=>{if(!Array.isArray(row) || row.length!==2 || !Number.isSafeInteger(row[0]) || !Number.isSafeInteger(row[1]) || row[0]<end || row[1]<=0 || row[0]+row[1]>value.startedAt+LISTENING_LIMITS.span)throw new Error(tr("Invalid listening time interval"));end=row[0]+row[1];totalMs+=row[1];return row.slice();});
  if(totalMs<LISTENING_LIMITS.threshold)throw new Error(tr("Minimum listening duration not reached"));
  const creatorId=text(value.creatorId || '',40);if(creatorId && !/^[A-Za-z0-9]{1,40}$/.test(creatorId))throw new Error(tr("Invalid listening artist identifier"));
  return {id:value.id,songId:value.songId,title:text(value.title),artist:text(value.artist),album:text(value.album || ''),source:['qq','bili','netease'].includes(value.source)?value.source:'local',creatorId,creatorName:text(value.creatorName || ''),startedAt:value.startedAt,segments,totalMs,endedAt:end};
}
export function normalizeListeningHistory(values=[]) {
  if(!Array.isArray(values) || values.length>LISTENING_LIMITS.sessions)throw new Error(tr("Listening records exceed 10000 record limit"));
  const ids=new Set();return values.map(value=>{const row=normalizeListening(value);if(ids.has(row.id))throw new Error(tr("Duplicate listening record identifiers"));ids.add(row.id);return row;});
}
export const listeningFilter=value=>({period:['day','week','month','year','all'].includes(value?.period)?value.period:'month',offset:Number.isSafeInteger(value?.offset)?Math.max(0,Math.min(120,value.offset)):0});
export function listeningBounds(filter,now=Date.now()) {
  const {period,offset}=listeningFilter(filter),date=new Date(now);date.setHours(0,0,0,0);
  if(period==='all')return {start:0,end:now+1,label:tr("All time"),period,offset:0};
  if(period==='day')date.setDate(date.getDate()-offset);
  if(period==='week'){date.setDate(date.getDate()-((date.getDay()+6)%7)-offset*7);}
  if(period==='month'){date.setDate(1);date.setMonth(date.getMonth()-offset);}
  if(period==='year'){date.setMonth(0,1);date.setFullYear(date.getFullYear()-offset);}
  const end=new Date(date);if(period==='day')end.setDate(end.getDate()+1);if(period==='week')end.setDate(end.getDate()+7);if(period==='month')end.setMonth(end.getMonth()+1);if(period==='year')end.setFullYear(end.getFullYear()+1);
  return {start:+date,end:+end,label:period==='year'?String(date.getFullYear()):period==='month'?date.toLocaleDateString(currentLanguage(),{month:'long',year:'numeric'}):period==='week'?tr('Week of {0}',date.toLocaleDateString(currentLanguage(),{month:'short',day:'numeric'})):date.toLocaleDateString(currentLanguage()),period,offset};
}

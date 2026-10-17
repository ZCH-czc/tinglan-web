/* Local note fields and limits follow Android notes/SongNotes.kt. GPL-3.0. */
import {validId} from './library-data.mjs';

export const NOTE_LIMITS=Object.freeze({notes:10000,content:12000,category:32,title:2000,artists:2000,pageSize:24,query:128,payloadBytes:128*1024});
const text=(value,limit,label)=>{if(typeof value!=='string' || value.length>limit)throw new Error(`${label} exceeds supported length`);return value;};
const time=value=>Number.isSafeInteger(value) && value>=0 && value<=8640000000000000;
export function normalizeNote(value) {
  if(!value || !validId(value.songId))throw new Error('Invalid track identifier in note');
  const content=text(value.content,NOTE_LIMITS.content,'Note').trim();if(!content)throw new Error('Enter note content first');
  if(!time(value.createdAt) || !time(value.updatedAt) || value.updatedAt<value.createdAt)throw new Error('Invalid note save time');
  return {songId:value.songId,title:text(value.title,NOTE_LIMITS.title,'Track title'),artists:text(value.artists,NOTE_LIMITS.artists,'Artist name'),content,category:text(value.category ?? '',NOTE_LIMITS.category,'Note category').trim() || 'Thoughts',createdAt:value.createdAt,updatedAt:value.updatedAt};
}
export function normalizeNotes(values=[]) {
  if(!Array.isArray(values) || values.length>NOTE_LIMITS.notes)throw new Error('Note count exceeds 10000 entry limit');
  const notes=values.map(normalizeNote);if(new Set(notes.map(row=>row.songId)).size!==notes.length)throw new Error('Backup contains duplicate track notes');return notes;
}
export function noteFilter(value={}) {
  return {query:typeof value.query==='string'?value.query.slice(0,NOTE_LIMITS.query):'',category:typeof value.category==='string'?value.category.slice(0,NOTE_LIMITS.category):'',page:Number.isSafeInteger(value.page)?Math.max(0,Math.min(416,value.page)):0};
}
export function notePreview(note) {return {songId:note.songId,title:note.title,artists:note.artists,category:note.category,preview:note.content.slice(0,320),updatedAt:note.updatedAt};}

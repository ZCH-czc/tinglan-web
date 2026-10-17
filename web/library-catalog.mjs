/** Library presentation and edits are independent of the player clock and platform transport. */
export const LIBRARY_TABS=['overview','playlists','platform','activity','songs','artists','albums','notes'];
export const LIBRARY_PAGE_SIZE=100;
export const SONG_SORTS=['custom','recent','title','artist','album','duration'];
const validId=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const bounded=(value,size)=>typeof value==='string'?value.trim().slice(0,size):'';
export const libraryOrder=value=>[...new Set((Array.isArray(value)?value:[]).filter(id=>LIBRARY_TABS.includes(id))),...LIBRARY_TABS].filter((id,index,rows)=>rows.indexOf(id)===index);
export function playlistDetails(value={}) {
  const tags=[...new Set((Array.isArray(value.tags)?value.tags:[]).map(s=>bounded(s,32)).filter(Boolean))].slice(0,20);
  return {description:bounded(value.description,1000),tags,background: ['song','custom'].includes(value.background)?value.background:'none',backgroundTrackId:validId(value.backgroundTrackId)?value.backgroundTrackId:'',backgroundOpacity:Number.isFinite(value.backgroundOpacity)?Math.max(.04,Math.min(.35,value.backgroundOpacity)):.12};
}
export function libraryPreferences(value={}) {
  return {libraryOrder:libraryOrder(value.libraryOrder),libraryView:value.libraryView==='grid'?'grid':'list',librarySource:['qq','bili','netease','local'].includes(value.librarySource)?value.librarySource:'all',libraryTag:bounded(value.libraryTag,32),sort:SONG_SORTS.includes(value.sort)?value.sort:'recent',sortDescending:value.sortDescending===true,recentTrackIds:[...new Set((Array.isArray(value.recentTrackIds)?value.recentTrackIds:[]).filter(validId))].slice(0,100)};
}
const collator=new Intl.Collator('en-US',{numeric:true,sensitivity:'base'});
export function orderedSongs(rows,sort='recent',descending=false) {
  if(sort==='custom')return descending?[...rows].reverse():rows;
  const sign=descending?-1:1;
  return [...rows].sort((a,b)=>sign*(sort==='recent'?(b.addedAt || 0)-(a.addedAt || 0):sort==='duration'?(a.durationMs || 0)-(b.durationMs || 0):collator.compare(a[sort] || '',b[sort] || '')) || a.id.localeCompare(b.id));
}
export function libraryView(records,playlists,preferences,request={}) {
  const prefs=libraryPreferences(preferences),tab=request.tab || 'overview',selected=playlists.find(p=>p.id===request.playlistId);
  const words=bounded(request.query,200).normalize('NFKC').toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const match=row=>words.every(word=>`${row.title || row.name || ''}\n${row.artist || ''}\n${row.album || ''}`.normalize('NFKC').toLocaleLowerCase().includes(word));
  const all=[...records.values()],counts={songs:all.length,favorites:all.filter(s=>s.favorite).length,cached:all.filter(s=>s.cached).length,local:all.filter(s=>s.source==='local').length,playlists:playlists.length};
  let rows=selected?selected.trackIds.map(id=>records.get(id)).filter(Boolean):all;
  if(!selected){if(tab==='favorites')rows=rows.filter(s=>s.favorite);if(tab==='cached')rows=rows.filter(s=>s.cached);if(tab==='local')rows=rows.filter(s=>s.source==='local');if(tab==='recent')rows=prefs.recentTrackIds.map(id=>records.get(id)).filter(Boolean);}
  if(prefs.librarySource!=='all')rows=rows.filter(s=>s.source===prefs.librarySource);
  if(request.group && ['artists','albums'].includes(tab))rows=rows.filter(s=>(tab==='artists'?(s.artist || 'Unknown artist'):(s.album || 'Unknown album'))===request.group);
  rows=rows.filter(match);if(tab!=='recent')rows=orderedSongs(rows,selected&&prefs.sort==='recent'?'custom':prefs.sort,prefs.sortDescending);
  const groups=[];
  if(!request.group && !selected && ['artists','albums'].includes(tab)) {
    const found=new Map();for(const row of rows){const name=(tab==='artists'?row.artist:row.album) || (tab==='artists'?'Unknown artist':'Unknown album');let group=found.get(name);if(!group){group={name,count:0,coverId:row.id,duration:0};found.set(name,group);}++group.count;group.duration+=row.durationMs || 0;}
    groups.push(...found.values());groups.sort((a,b)=>collator.compare(a.name,b.name)*(prefs.sortDescending?-1:1));
  }
  const tags=[...new Set(playlists.flatMap(p=>playlistDetails(p).tags))].sort(collator.compare);
  const listed=playlists.filter(p=>(!prefs.libraryTag || playlistDetails(p).tags.includes(prefs.libraryTag)) && match(p));
  const total=groups.length || (tab==='playlists'&&!selected?listed.length:rows.length),pages=Math.max(1,Math.ceil(total/LIBRARY_PAGE_SIZE)),page=Math.max(0,Math.min(pages-1,Number.isSafeInteger(request.page)?request.page:0));
  return {tab,group:request.group || '',query:request.query || '',page,pages,total,duration:rows.reduce((n,s)=>n+(s.durationMs || 0),0),counts,tags,order:prefs.libraryOrder,view:prefs.libraryView,source:prefs.librarySource,tag:prefs.libraryTag,sort:prefs.sort,descending:prefs.sortDescending,selected,allIds:rows.map(s=>s.id),songs:rows.slice(page*LIBRARY_PAGE_SIZE,(page+1)*LIBRARY_PAGE_SIZE),groups:groups.slice(page*LIBRARY_PAGE_SIZE,(page+1)*LIBRARY_PAGE_SIZE),listed:listed.slice(page*LIBRARY_PAGE_SIZE,(page+1)*LIBRARY_PAGE_SIZE),recent:prefs.recentTrackIds.slice(0,12).map(id=>records.get(id)).filter(Boolean)};
}
/** One serial writer commits storage first. A failed edit never changes the visible catalogue. */
export class PlaylistEditor {
  constructor({read,write,remove,accepted}){Object.assign(this,{read,write,remove,accepted});this.pending=Promise.resolve();}
  run(id,operation,write=this.write){const next=this.pending.catch(()=>{}).then(async()=>{const old=await this.read(id);const value=operation(old);if(value===null){if(!old)throw new Error('Playlist no longer exists');await this.remove(id);this.accepted(id,null);return null;}if(!value || value.id!==id || !validId(value.id) || !value.name?.trim() || value.name.trim().length>80 || !Array.isArray(value.trackIds) || value.trackIds.length>10000 || value.trackIds.some(id=>!validId(id)) || new Set(value.trackIds).size!==value.trackIds.length)throw new Error('Invalid playlist metadata');const normalized={...value,name:value.name.trim(),...playlistDetails(value)};if(normalized.background==='song' && !normalized.trackIds.includes(normalized.backgroundTrackId)){normalized.background='none';normalized.backgroundTrackId='';}await write(normalized);this.accepted(id,normalized);return normalized;});this.pending=next;return next;}
  patch(id,patch){return this.run(id,old=>{if(!old)throw new Error('Playlist no longer exists');return {...old,...patch,id,trackIds:old.trackIds};});}
  membership(id,ids,remove=false){return this.run(id,old=>{if(!old)throw new Error('Playlist no longer exists');const selected=new Set(ids);return {...old,trackIds:remove?old.trackIds.filter(id=>!selected.has(id)):[...new Set([...old.trackIds,...ids])]};});}
  move(id,songId,destinationId){return this.run(id,old=>{if(!old || !old.trackIds.includes(songId) || !old.trackIds.includes(destinationId))throw new Error('Playlist entry changed. Reorder again');const ids=[...old.trackIds],to=ids.indexOf(destinationId);ids.splice(ids.indexOf(songId),1);ids.splice(to,0,songId);return {...old,trackIds:ids};});}
}

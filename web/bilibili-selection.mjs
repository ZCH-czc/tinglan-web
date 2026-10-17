import {parseBilibiliId} from './bilibili-id.mjs';

/** Validate a UI selection against the accepted current video context, not an arbitrary track ID. */
export function planBilibiliSelection(context,currentId,selectedId,group='parts') {
  const current=parseBilibiliId(String(currentId).replace(/^bili-/,''));
  if(!current || context?.bvid!==current.bvid || !['parts','collection'].includes(group))throw new Error('Episode data changed. Reopen the episode selector');
  const songs=group==='parts'?(context.parts || []).map(row=>row.song):(context.collection?.songs || []);
  const selected=songs.find(song=>song.id===selectedId);if(!selected)throw new Error('This item is no longer in the current episodes or collection');
  const first=context.parts?.[0],same=selectedId===currentId || group==='parts' && selectedId===first?.song.id && current.cid===first.cid;
  const id=same?currentId:selectedId;
  return {id,same,songs,ids:[...new Set(songs.map(song=>same && song.id===selectedId?id:song.id))]};
}

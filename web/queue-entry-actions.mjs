/** Queue menus address the visible occurrence. A delayed menu cannot edit a newer target. */
export function editQueueEntry(engine,request,menu) {
  if(menu?.locked)throw new Error('Queue is locked. Unlock editing first');
  if(!menu?.active || !request || request.key!==menu.key || request.id!==menu.id || !request.key || engine.queueEntryId(request.key)!==request.id)throw new Error('This queue action expired. Reopen the menu');
  if(request.action==='move') {
    if(request.delta!==1 && request.delta!==-1)throw new Error('Invalid queue move direction');
    const at=engine.queueEntryIndex(request.key);return {changed:at>=0 && engine.moveQueueEntry(request.key,at+request.delta),removedCurrent:false};
  }
  if(request.action==='remove'){const current=engine.currentQueueKey()===request.key;return {changed:engine.removeQueueEntry(request.key),removedCurrent:current};}
  if(request.action==='next') {
    const at=engine.queueEntryIndex(request.key),current=engine.currentQueueIndex();
    return {changed:at!==current && current>=0 && engine.moveQueueEntry(request.key,current+(at>current?1:0)),removedCurrent:false};
  }
  throw new Error('Invalid queue action');
}

/** Pointer and keyboard edits bind both ends to visible occurrence keys, never a stale index. */
export function editVisibleQueueEntry(engine,request,view) {
  if(view?.locked)throw new Error('Queue is locked. Unlock editing first');
  const visible=new Set(view?.keys || []);
  if(!view?.open || !request?.key || !visible.has(request.key) || engine.queueEntryId(request.key)!==request.id)throw new Error('Queue entry changed. Reopen the queue');
  if(request.action==='remove'){const current=engine.currentQueueKey()===request.key;return {changed:engine.removeQueueEntry(request.key),removedCurrent:current};}
  if(request.action==='move-to') {
    if(!visible.has(request.destinationKey) || !engine.queueEntryId(request.destinationKey))throw new Error('Reorder target changed. Drag again');
    return {changed:engine.moveQueueEntry(request.key,engine.queueEntryIndex(request.destinationKey)),removedCurrent:false};
  }
  return editQueueEntry(engine,request,{active:true,id:request.id,key:request.key});
}

/** A gesture started on an outgoing song must never seek the newly selected song. */
export function seekCurrentTrack(engine,playback,request) {
  if(!request || request.id!==engine.currentId() || request.key!==engine.currentQueueKey())return false;
  const position=Number(request.position);
  if(!Number.isFinite(position) || position<0)return false;
  playback.seek(position);return true;
}

/** Source replacement and derived-index invalidation commit in the same media transaction. */
export const mediaRevisionKey=id=>'media-revision:'+id;
export function mediaChanged(tx,id){tx.objectStore('settings').put(crypto.randomUUID(),mediaRevisionKey(id));tx.objectStore('fingerprints').delete(id);}
export function mediaRemoved(tx,id){tx.objectStore('settings').delete(mediaRevisionKey(id));tx.objectStore('fingerprints').delete(id);}

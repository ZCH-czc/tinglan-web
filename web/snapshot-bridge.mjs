/** Immutable collection references cross the Wasm boundary only when their contents change. */
export class SnapshotBridge {
  constructor(send,collections=['libraryInfo','songs','playlists','queue','lyrics','sections','danmaku','creatorSongs','comments','collectionSongs','biliParts','biliCollectionSongs','activities','activityDetails','followingCreators','qrRows','accounts','biliActionFolders','transferQrRows','transferReceipts','liveCreators','noteItems','noteCategories','noteEditor','statsReport','radioItems','radioQueue','cacheItems','cacheTasks','audioInfo','audioDevices','recognition','localIndex']) {this.send=send;this.collections=new Set(collections);this.pages=new Map();this.global=new Map();}
  publish(snapshot) {
    const page=snapshot.viewKey || snapshot.page || 'global';if(!this.pages.has(page))this.pages.set(page,new Map());const previous=this.pages.get(page);
    this.pages.delete(page);this.pages.set(page,previous);while(this.pages.size>24)this.pages.delete(this.pages.keys().next().value);
    const delta={};for(const [key,value] of Object.entries(snapshot)){
      if(this.collections.has(key)){const retained=['qrRows','accounts','biliActionFolders','transferQrRows','transferReceipts','liveCreators','noteEditor','radioQueue','cacheTasks','audioInfo','audioDevices','recognition','localIndex'].includes(key)?this.global:previous;if(retained.get(key)===value)continue;retained.set(key,value);}
      delta[key]=value;
    }
    this.send(JSON.stringify(delta));
  }
  reset() {this.pages.clear();this.global.clear();}
}

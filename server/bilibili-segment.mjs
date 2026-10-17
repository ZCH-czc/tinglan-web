import {PlatformError} from './upstream.mjs';
import {parseBilibiliId} from '../web/bilibili-id.mjs';

export function resolveBilibiliSegment(view,remoteId) {
  const id=parseBilibiliId(remoteId);if(!id)throw new PlatformError('invalid-request','Invalid video identifier',400);
  if(view?.bvid!==id.bvid)throw new PlatformError('invalid-response','The platform returned a different video identifier');
  const pages=(view.pages || []).slice(0,1000),part=id.cid?pages.find(row=>String(row.cid)===id.cid):pages[0];
  if(!part || !/^[1-9]\d{0,18}$/.test(String(part.cid)) || typeof part.cid==='number' && !Number.isSafeInteger(part.cid))throw new PlatformError('not-found','This video part is unavailable. Refresh episodes',404);
  return {bvid:id.bvid,cid:part.cid,part,index:pages.indexOf(part)};
}
export async function loadBilibiliSegment(providers,track,session) {
  const id=parseBilibiliId(track.remoteId);if(!id)throw new PlatformError('invalid-request','Invalid video identifier',400);
  const view=(await providers.bili('/x/web-interface/view',{bvid:id.bvid},session)).data;
  return {view,...resolveBilibiliSegment(view,track.remoteId)};
}

/** Stable Android-compatible video identity. CID membership is verified against the provider view. */
export function parseBilibiliId(value) {
  if(typeof value!=='string')return null;
  const match=/^(BV[A-Za-z0-9]{10})(?:_cid_([1-9]\d{0,18}))?$/.exec(value);
  return match?{bvid:match[1],cid:match[2] || ''}:null;
}
export function bilibiliPartId(bvid,cid) {
  const value=`${bvid}_cid_${cid}`;return parseBilibiliId(value)?value:null;
}

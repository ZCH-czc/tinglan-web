import {createHash} from 'node:crypto';
import {safeHttps} from './upstream.mjs';

// Only public raster artwork is accepted; no account cookies reach these CDNs.
export const PUBLIC_IMAGE_HOSTS={qq:['y.gtimg.cn','qlogo.cn','gtimg.com'],bili:['hdslb.com'],netease:['music.126.net']};
export function publicImage(source,address) {
  const url=PUBLIC_IMAGE_HOSTS[source] && safeHttps(address,PUBLIC_IMAGE_HOSTS[source]);
  if(!url || url.length>2048)return null;
  return {key:'image-'+source+'-'+createHash('sha256').update(url).digest('hex').slice(0,40),path:'/api/public-image?'+new URLSearchParams({source,address:url})};
}

import {createHash} from 'node:crypto';
import {radioStation,radioUrl} from '../web/radio-data.mjs';
import {PlatformError} from './upstream.mjs';

export function customRadio(input) {
  const name=typeof input?.name==='string'?input.name.trim():'';
  if(name.length<1 || name.length>80)throw new PlatformError('invalid-request','Enter a station name (up to 80 characters）',400);
  const url=radioUrl(input.url);if(!url)throw new PlatformError('invalid-request','Enter a valid HTTPS stream URL',400);
  const hash=createHash('md5').update(url,'utf8').digest();hash[6]=(hash[6]&15)|48;hash[8]=(hash[8]&63)|128;const hex=hash.toString('hex'),uuid=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  try{return radioStation({uuid,name,streamUrl:url,custom:true});}catch(error){throw new PlatformError('invalid-request',error.message,400);}
}
export function radioSource(resources,directory,input,session) {
  let station;try{station=radioStation(input.station);}catch(error){throw new PlatformError('invalid-request',error.message,400);}
  const url=resources.register(station.streamUrl,session.id,station.hls?'playlist':'broadcast');
  // The public directory's click count never blocks or changes station playback.
  if(input.countListen!==false)void directory.count(station,AbortSignal.timeout(5000));
  return {url,hls:station.hls};
}

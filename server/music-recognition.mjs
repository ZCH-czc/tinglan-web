import {randomUUID} from 'node:crypto';
import {PlatformError} from './upstream.mjs';
import {mapNetease} from './providers.mjs';
export function recognitionForm(input,sessionId=randomUUID()) {
  if(!input || Object.keys(input).some(k=>!['fingerprint','duration'].includes(k)) || input.duration!==6 || typeof input.fingerprint!=='string' || input.fingerprint.length<4 || input.fingerprint.length>87384 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.fingerprint))throw new PlatformError('invalid-request','Invalid recognition fingerprint format',400);
  const bytes=Buffer.from(input.fingerprint,'base64');if(bytes.length<1 || bytes.length>65536 || bytes.toString('base64')!==input.fingerprint)throw new PlatformError('invalid-request','Invalid recognition fingerprint format',400);
  return new URLSearchParams({sessionId,algorithmCode:'shazam_v2',duration:'6',rawdata:input.fingerprint,times:'2',decrypt:'1'}).toString();
}
/** The native app's pinned extension protocol. Anonymous fingerprints only; no account cookies or audio upload. */
export class MusicRecognitionGateway {
  constructor(net,{now=Date.now}={}){this.net=net;this.now=now;this.requests=new Map();}
  async match(session,input,signal) {
    const body=recognitionForm(input),old=this.requests.get(session),now=this.now();
    if(old?.busy)throw new PlatformError('busy','Recognition is running. Wait for it to finish',409);
    if(old?.until>now)throw new PlatformError('cooldown','Wait before recognizing another segment',429,Math.ceil((old.until-now)/1000));
    for(const [id,row] of this.requests)if(!row.busy && row.until<=now)this.requests.delete(id);
    if(this.requests.size>=100 && !this.requests.has(session))throw new PlatformError('busy','Recognition service is busy. Retry later',429,10);
    const owner={busy:true,until:now+10000};this.requests.set(session,owner);
    try {
      const data=await this.net.json('netease','https://interface.music.163.com/api/music/audio/match',{method:'POST',signal,body,cache:'no-store',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json','Referer':'https://music.163.com/'}},0,'recognition-anonymous');
      signal?.throwIfAborted();if(data.code!==200 || !Array.isArray(data.data?.result))throw new PlatformError('invalid-response','Recognition service returned no valid result');
      if(data.data.result.length===0)return {matched:false,song:null};
      for(const row of data.data.result.slice(0,20)){const id=String(row?.song?.id || '');if(!/^[1-9]\d{0,18}$/.test(id) || !row.song.name)continue;const song=mapNetease({...row.song,id:Number(id)});if(song)return {matched:true,song};}
      throw new PlatformError('invalid-response','Recognition result is missing track metadata');
    }finally{owner.busy=false;}
  }
}

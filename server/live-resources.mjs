import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {PlatformError} from './upstream.mjs';
import {liveUrl} from './bilibili-live.mjs';

/** Opaque HLS grants: no platform cookies, signed CDN URLs or arbitrary proxy targets reach clients. */
export class LiveResources {
  constructor({fetcher=fetch,headers=()=>({}),now=Date.now,validate=liveUrl,prefix='/api/live-media'}={}) {if(!['/api/live-media','/api/radio-media'].includes(prefix))throw new TypeError('Invalid media prefix');Object.assign(this,{fetcher,headers,now,validate,prefix});this.grants=new Map();this.pathPattern=new RegExp('^'+prefix+'/([a-f0-9]{48})/([a-f0-9]{40})$');}
  remove(key) {const g=this.grants.get(key);this.grants.delete(key);for(const controller of g?.controllers || [])controller.abort();}
  revokeSession(session) {for(const [key,g] of this.grants)if(g.session===session)this.remove(key);}
  prune() {for(const [key,g] of this.grants)if(g.expiry<this.now())this.remove(key);}
  register(url,session,kind='playlist') {
    if(!this.validate(url))throw new PlatformError('invalid-response','Invalid live source');
    this.prune();const key=randomBytes(24).toString('hex'),grant={session,kind,expiry:this.now()+1_800_000,entries:new Map(),byUrl:new Map(),controllers:new Set()};this.grants.set(key,grant);
    const art=kind==='artwork',owned=[...this.grants].filter(([,g])=>g.session===session && (g.kind==='artwork')===art);for(const [old] of owned.slice(0,Math.max(0,owned.length-(art?96:8))))this.remove(old);
    const kindGrants=[...this.grants].filter(([,g])=>(g.kind==='artwork')===art);for(const [old] of kindGrants.slice(0,Math.max(0,kindGrants.length-(art?192:64))))this.remove(old);
    return this.entry(key,grant,url,kind,0);
  }
  revoke(path,session) {const key=this.pathPattern.exec(path || '')?.[1];if(key && this.grants.get(key)?.session===session)this.remove(key);}
  entry(key,g,url,kind,depth) {
    if(depth>4 || !this.validate(url) || url.length>8192 || !['playlist','segment','key','broadcast','artwork'].includes(kind))throw new PlatformError('invalid-response','Invalid live resource');
    const identity=`${kind}|${url}`;let id=g.byUrl.get(identity);
    if(id && g.entries.has(id)){const old=g.entries.get(id);g.entries.delete(id);g.entries.set(id,old);}
    else {id=randomBytes(20).toString('hex');g.entries.set(id,{url,kind,depth,identity});g.byUrl.set(identity,id);}
    while(g.entries.size>512){const first=g.entries.keys().next().value;g.byUrl.delete(g.entries.get(first).identity);g.entries.delete(first);}
    return `${this.prefix}/${key}/${id}`;
  }
  rewrite(raw,base,key,g,depth) {
    if(!raw.startsWith('#EXTM3U') || raw.length>262144)throw new PlatformError('invalid-response','Invalid live playlist');
    let masterNext=false;
    return raw.split(/\r?\n/).map(line=>{
      line=line.trim();if(!line)return '';
      if(!line.startsWith('#')){const kind=masterNext?'playlist':'segment';masterNext=false;return this.entry(key,g,new URL(line,base).href,kind,depth+(kind==='playlist'?1:0));}
      if(line.startsWith('#EXT-X-STREAM-INF:'))masterNext=true;
      if(line.startsWith('#EXT-X-DEFINE:') || line.startsWith('#EXT-X-CONTENT-STEERING:') || line.startsWith('#EXT-X-SESSION-DATA:'))return ''; // External metadata / variable URLs are not loaded.
      if(!line.startsWith('#EXT'))return ''; // Signed URLs must not leak through arbitrary comments.
      const playlist=/^#EXT-X-(MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT):/.test(line),keyTag=/^#EXT-X-(KEY|SESSION-KEY):/.test(line);
      if(keyTag && !/METHOD=(NONE|AES-128)(?:,|$)/.test(line))throw new PlatformError('unavailable','This live encryption format is unsupported');
      if(keyTag && /KEYFORMAT=/.test(line) && !/KEYFORMAT="identity"/.test(line))throw new PlatformError('unavailable','This live encryption format is unsupported');
      line=line.replace(/URI="([^"\r\n]+)"/g,(_,address)=>`URI="${this.entry(key,g,new URL(address,base).href,playlist?'playlist':keyTag?'key':'segment',depth+(playlist?1:0))}"`);
      if(new RegExp('(?:https?://|data:|file:|URI=(?!"'+this.prefix+'/))').test(line))throw new PlatformError('invalid-response','Live playlist includes an unsupported source');
      return line;
    }).join('\n');
  }
  async serve(req,res,path,session) {
    this.prune();const match=this.pathPattern.exec(path),g=match && this.grants.get(match[1]),entry=g?.entries.get(match?.[2]);
    if(!g || !entry || g.session!==session)throw new PlatformError('expired','Live URL expired. Reopen the stream',410);
    g.entries.delete(match[2]);g.entries.set(match[2],entry); // Frequently refreshed playlists survive segment eviction.
    const range=req.headers.range;if(range && !/^bytes=\d*-\d*$/.test(range))throw new PlatformError('invalid-request','Invalid live range',416);
    const controller=new AbortController();let timer;const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),15000);timer.unref?.();};touch();const closed=()=>controller.abort();res.once('close',closed);g.controllers.add(controller);
    let response,address=entry.url;
    try {
      for(let redirect=0;redirect<=2;redirect++) {
        if(!this.validate(address))throw new PlatformError('invalid-response','Invalid live source');
        response=await this.fetcher(address,{method:req.method==='HEAD'?'HEAD':'GET',headers:{'User-Agent':this.headers()['User-Agent'] || 'Tinglan',...(this.prefix==='/api/live-media'?{Referer:'https://live.bilibili.com/'}:{}),...(range && entry.kind!=='playlist'?{Range:range}:{})},redirect:'manual',signal:controller.signal});
        if(response.status>=300 && response.status<400){const next=response.headers.get('location');await response.body?.cancel();if(!next || redirect===2)throw new PlatformError('network','Live source unavailable',503);address=new URL(next,address).href;continue;}break;
      }
      if([401,403,412,429].includes(response.status)){await response.body?.cancel();throw new PlatformError('rights','Live access denied or verification required. Retry manually later',401);}
      if(!response.ok && response.status!==206){await response.body?.cancel();throw new PlatformError('network','Live connection interrupted. Retry manually',503);}
      // Successful requests extend the idle deadline; uninterrupted viewing must not expire after 30 minutes.
      g.expiry=this.now()+1_800_000;
      const limit=entry.kind==='broadcast'?0:entry.kind==='artwork'?8*1024*1024:entry.kind==='playlist'?262144:entry.kind==='key'?16:32*1024*1024;
      const type=response.headers.get('content-type') || 'application/octet-stream';
      if(entry.kind==='artwork' && !/^image\/(png|jpeg|webp|gif|avif)(?:;|$)/i.test(type) || entry.kind==='broadcast' && !/^(audio\/[a-z0-9.+-]+|application\/octet-stream)(?:;|$)/i.test(type)){await response.body?.cancel();throw new PlatformError('invalid-response','Unsupported station resource format');}
      if(limit && Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw new PlatformError('invalid-response','Live resource is too large');}
      if(req.method==='HEAD'){await response.body?.cancel();res.writeHead(200,{'Cache-Control':'no-store','Content-Type':entry.kind==='playlist'?'application/vnd.apple.mpegurl':['broadcast','artwork'].includes(entry.kind)?type:'application/octet-stream'});res.end();return;}
      if(entry.kind==='playlist') {
        let length=0;const chunks=[];for await(const chunk of response.body){length+=chunk.length;if(length>limit){controller.abort();throw new PlatformError('invalid-response','Live playlist is too large');}chunks.push(chunk);}
        const content=Buffer.from(this.rewrite(Buffer.concat(chunks).toString('utf8'),address,match[1],g,entry.depth));
        res.writeHead(200,{'Content-Type':'application/vnd.apple.mpegurl','Cache-Control':'no-store','Content-Length':content.length,'X-Content-Type-Options':'nosniff'});res.end(content);
      } else {
        const headers={'Content-Type':['broadcast','artwork'].includes(entry.kind)?type:'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
        for(const key of ['content-length','content-range','accept-ranges'])if(response.headers.has(key))headers[key]=response.headers.get(key);
        res.writeHead(response.status,headers);let total=0;
        for await(const chunk of response.body){total+=chunk.length;if(limit && total>limit){controller.abort();res.destroy();return;}if(entry.kind==='broadcast'){touch();g.expiry=this.now()+1_800_000;}if(!res.write(chunk))await once(res,'drain',{signal:controller.signal});}res.end();
      }
    } finally {clearTimeout(timer);g.controllers.delete(controller);res.removeListener('close',closed);}
  }
}

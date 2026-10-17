import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { once } from 'node:events';
import { RequestGovernor, PlatformError, safeHttps } from './upstream.mjs';
import { PlatformProviders, MEDIA_HOSTS, ART_HOSTS } from './providers.mjs';
import { biliVideo,biliDanmaku,BILI_QUALITIES } from './bilibili-video.mjs';
import { creatorProfile,creatorSongs,validCreator,qqAvatar,searchCreators } from './creators.mjs';
import {comments,bilibiliReplies} from './comments.mjs';
import {activityFeed,activityDetail,activitySongs,followedCreators} from './bilibili-activities.mjs';
import {collection} from './collections.mjs';
import {PUBLIC_IMAGE_HOSTS,publicImage} from './content-images.mjs';
import {parseBilibiliId} from '../web/bilibili-id.mjs';
import {bilibiliContext} from './bilibili-context.mjs';
import {liveDetail,liveManifest} from './bilibili-live.mjs';
import {LiveResources} from './live-resources.mjs';
import {AccountLogins} from './account-logins.mjs';
import {BilibiliActions} from './bilibili-actions.mjs';
import {WebDavHandoff} from './webdav-handoff.mjs';
import {jsonReply as reply} from './http-replies.mjs';
import {LanTransfer} from './lan-transfer.mjs';
import {LivePresenceRepository} from './bilibili-presence.mjs';
import {RadioDirectory,qqRadios,qqRadioTracks} from './radio-catalog.mjs';
import {customRadio,radioSource} from './radio-source.mjs';
import {radioUrl,radioStation} from '../web/radio-data.mjs';
import {retryAfterSeconds} from '../web/playback-recovery.mjs';
import {MusicRecognitionGateway} from './music-recognition.mjs';
import {SessionRenewal} from './session-renewal.mjs';

const sources = ['qq','bili','netease'];
async function body(req,limit=16384) {
  const chunks=[];let size=0;for await(const chunk of req) {size+=chunk.length;if(size>limit)throw new PlatformError('invalid-request','Request is too large',413);chunks.push(chunk);}
  try {const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('Invalid body');return value;}catch{throw new PlatformError('invalid-request','Invalid request content',400)}
}
/** Same-origin local companion. Media URLs are provider-owned; public raster images are separately CDN-allowlisted. */
export function createGateway({ providers, fetcher=fetch, now=Date.now, loginProtocols,renewalProtocols,renewalTimers,lanFiles,lanOptions,radioDiscover }={}) {
  providers ||= new PlatformProviders(new RequestGovernor({fetcher,now}));
  const recognition=new MusicRecognitionGateway(providers.net,{now});
  const sessions=new Map();const catalog=new Map();const streams=new Map();const mediaCooldowns=new Map();
  const liveResources=new LiveResources({fetcher,now,headers:()=>providers.headers('bili')});
  const radioResources=new LiveResources({fetcher,now,validate:radioUrl,prefix:'/api/radio-media'});
  const radioDirectory=new RadioDirectory({fetcher,now,discover:radioDiscover});
  function installAccount(session,source,cookie,credential) {
    renewal.clearSource(session,source);
    if(cookie)session.cookies[source]=cookie;else delete session.cookies[source];
    session.accounts ||= {};session.accounts[source]={status:cookie?'unverified':'disconnected',name:'',error:''};
    ++session.generation;session.accountRevision=randomBytes(16).toString('hex');session.loginIntent=0;
    providers.net?.clearIdentity(session.id);for(const [key,value] of streams)if(value.session===session.id)streams.delete(key);
    liveResources.revokeSession(session.id);logins.clearSession(session.id);biliActions.clearSession(session.id);webdav.invalidate(session.id);presence.clear(session.id);void lan.clear(session.id).catch(()=>{});
    renewal.install(session,source,credential);
  }
  const renewal=new SessionRenewal({providers,now,protocols:renewalProtocols,...renewalTimers,ownsSession:session=>sessions.get(session.id)===session && session.expiry>now(),changed:(session,source)=>{if(source==='bili')biliActions.clearSession(session.id);},canStart:(session,source)=>source!=='bili' || !biliActions.isMutating(session.id)});
  providers.renewal=renewal;
  const logins=new AccountLogins({providers,protocols:loginProtocols,now,renewal,install:installAccount,ownsSession:session=>sessions.get(session.id)===session && session.expiry>now()});
  const biliActions=new BilibiliActions({providers,now,ownsSession:session=>sessions.get(session.id)===session && session.expiry>now()});
  const webdav=new WebDavHandoff({fetcher,now,ownsSession:session=>sessions.get(session.id)===session && session.expiry>now()});
  const lan=new LanTransfer({now,...lanOptions,files:lanFiles,ownsSession:session=>sessions.get(session.id)===session && session.expiry>now()});
  const presence=new LivePresenceRepository({providers,now,ownsSession:session=>sessions.get(session.id)===session && session.expiry>now()});
  function registerStream(data,source,session,kind='audio') {
    const token=randomBytes(24).toString('hex');streams.set(token,{...data,source,kind,session:session.id,expiry:now()+1_800_000});
    const same=[...streams].filter(([,value])=>value.kind===kind);const limit=kind==='video'?96:kind==='download'?64:32;for(const [key] of same.slice(0,Math.max(0,same.length-limit)))streams.delete(key);
    return `/api/media/${token}`;
  }
  function getSession(req,res) {
    // Cookies have no port scope. Parallel local previews must not overwrite each other's owner.
    const port=Number(req.socket?.localPort),cookieName=Number.isInteger(port)&&port>0&&port<=65535?`tinglan_session_${port}`:'tinglan_session';
    const values=String(req.headers.cookie || '').split(';').map(p=>p.trim());
    const read=name=>values.find(p=>p.startsWith(name+'='))?.slice(name.length+1);
    const scoped=read(cookieName),id=scoped || read('tinglan_session');
    let session=sessions.get(id);
    for(const [key,value] of sessions)if(value.expiry<=now()){renewal.clearSession(key);sessions.delete(key);liveResources.revokeSession(key);radioResources.revokeSession(key);logins.clearSession(key);biliActions.clearSession(key);webdav.clearSession(key);presence.clear(key);void lan.clear(key).catch(()=>{});}
    if(!session || !sessions.has(session.id)) {session={id:randomBytes(24).toString('hex'),cookies:{},accounts:{},accountRevision:randomBytes(16).toString('hex'),generation:0,expiry:now()+86_400_000};sessions.set(session.id,session);res.setHeader('Set-Cookie',`${cookieName}=${session.id}; HttpOnly; SameSite=Strict; Path=/`);while(sessions.size>100){const old=sessions.keys().next().value;renewal.clearSession(old);liveResources.revokeSession(old);radioResources.revokeSession(old);logins.clearSession(old);biliActions.clearSession(old);webdav.clearSession(old);presence.clear(old);void lan.clear(old).catch(()=>{});sessions.delete(old);}}
    else if(!scoped && cookieName!=='tinglan_session')res.setHeader('Set-Cookie',`${cookieName}=${session.id}; HttpOnly; SameSite=Strict; Path=/`);
    session.expiry=now()+86_400_000;
    return session;
  }
  function remember(songs) {for(const song of songs)catalog.set(song.id,song);while(catalog.size>2000)catalog.delete(catalog.keys().next().value);}
  async function getTrack(id,session) {
    if(catalog.has(id))return catalog.get(id);
    const match=/^(qq|bili|netease)-([A-Za-z0-9_]{1,40})$/.exec(id);
    if(!match || (match[1]==='qq' && !/^[a-zA-Z0-9]{5,32}$/.test(match[2])) || (match[1]==='bili' && !parseBilibiliId(match[2])) || (match[1]==='netease' && !/^\d{1,18}$/.test(match[2])))throw new PlatformError('invalid-request','Invalid track identifier',400);
    return {id,source:match[1],remoteId:match[2],title:'',artist:'',durationMs:0};
  }
  async function resource(req,res,urls,source,type,maxBytes=0,hosts) {
    const waiting=(mediaCooldowns.get(source) || 0)-now();
    if(waiting>0)throw new PlatformError('cooldown','Media source is cooling down. Retry later',429,Math.ceil(waiting/1000));
    const controller=new AbortController();res.once('close',()=>controller.abort());
    let response;
    const range=req.headers.range;
    if(range && !/^bytes=\d*-\d*$/.test(range))throw new PlatformError('invalid-request','Invalid playback range',416);
    for(const start of urls) {
      let next=start;
      for(let redirects=0;redirects<=2;redirects++) {
        if(!safeHttps(next,hosts || (maxBytes ? ART_HOSTS[source] : MEDIA_HOSTS[source])))throw new PlatformError('invalid-response','Invalid resource hostname');
        const timer=setTimeout(()=>controller.abort(),12_000);
        try {response=await fetcher(next,{method:req.method==='HEAD'?'HEAD':'GET',headers:{...providers.headers(source),...(range?{Range:range}:{})},redirect:'manual',signal:controller.signal});}finally{clearTimeout(timer)}
        if(response.status>=300 && response.status<400) {const target=response.headers.get('location');if(!target)break;next=new URL(target,next).href;await response.body?.cancel();continue;}
        break;
      }
      if(response?.ok || response?.status===206)break;
      if([412,429].includes(response?.status)) {
        const delay=retryAfterSeconds(response.headers.get('retry-after'),now()) || 60;
        await response.body?.cancel();mediaCooldowns.set(source,now()+delay*1000);providers.net?.defer?.(source,delay);
        throw new PlatformError('verification','Media source requested a delay. Automatic requests stopped',429,delay);
      }
      if([401,403].includes(response?.status)) {await response.body?.cancel();throw new PlatformError('rights','Resource access denied. Check account or content permissions',401);}
      await response?.body?.cancel();
    }
    if([404,410,416].includes(response?.status))throw new PlatformError('source-expired','Media URL expired. Resolve a new playback URL',410);
    if(!response?.ok && response?.status!==206)throw new PlatformError('network','Media source unavailable',503);
    const length=Number(response.headers.get('content-length'));
    if(maxBytes && length>maxBytes){await response.body?.cancel();throw new PlatformError('invalid-response','Artwork resource is too large');}
    const responseType=response.headers.get('content-type');const headers={'Content-Type':!responseType || responseType.split(';')[0]==='application/octet-stream'?type:responseType,'Cache-Control':maxBytes?'private, max-age=600':'private, no-store','X-Content-Type-Options':'nosniff'};
    if(hosts && !/^image\/(jpeg|png|webp|gif|avif)(?:;|$)/i.test(headers['Content-Type'])){await response.body?.cancel();throw new PlatformError('invalid-response','Unsupported image resource format');}
    for(const name of ['content-length','content-range','accept-ranges'])if(response.headers.has(name))headers[name]=response.headers.get(name);
    res.writeHead(response.status,headers);
    if(req.method==='HEAD') {await response.body?.cancel();res.end();return;}
    if(maxBytes) {let total=0;for await(const chunk of response.body){total+=chunk.length;if(total>maxBytes){controller.abort();res.destroy();return}if(!res.write(chunk))await once(res,'drain',{signal:controller.signal});}res.end();}
    else await pipeline(Readable.fromWeb(response.body),res,{signal:controller.signal});
  }
  return async function handle(req,res) {
    const url=new URL(req.url,'http://localhost');
    if(!url.pathname.startsWith('/api/'))return false;
    try {
      const host=String(req.headers.host || '');
      if(!/^(localhost|127\.0\.0\.1):\d+$/.test(host))throw new PlatformError('forbidden','This service is for local use only',403);
      const origin=req.headers.origin;
      if(origin && origin!==`http://${host}` && origin!==`https://${host}`)throw new PlatformError('forbidden','Invalid request origin',403);
      if(req.headers['sec-fetch-site']==='cross-site')throw new PlatformError('forbidden','Invalid request origin',403);
      const session=getSession(req,res);
      const source=url.searchParams.get('source');
      if(url.pathname==='/api/recognition'){
        if(req.method!=='POST')throw new PlatformError('invalid-request','Invalid recognition request method',405);
        const controller=new AbortController(),closed=()=>controller.abort();res.once('close',closed);
        try{const result=await recognition.match(session.id,await body(req,90000),controller.signal);controller.signal.throwIfAborted();if(result.song)remember([result.song]);await reply(res,200,result);}finally{res.removeListener('close',closed);}return true;
      }
      if(url.pathname==='/api/health') {await reply(res,200,{ok:true,version:'0.31.1',sources});return true;}
      if(url.pathname==='/api/cache-revoke'){
        if(req.method!=='POST')throw new PlatformError('invalid-request','Invalid download request method',405);
        const input=await body(req),token=typeof input.path==='string' && /^\/api\/media\/[a-f0-9]{48}$/.test(input.path)?input.path.slice(11):'';
        if(!token)throw new PlatformError('invalid-request','Invalid download resource identifier',400);
        const entry=streams.get(token);if(entry?.session===session.id && entry.kind==='download')streams.delete(token);
        await reply(res,200,{ok:true});return true;
      }
      if(url.pathname.startsWith('/api/radio-media/')){if(!['GET','HEAD'].includes(req.method))throw new PlatformError('invalid-request','Invalid station resource request method',405);await radioResources.serve(req,res,url.pathname,session.id);return true;}
      if(url.pathname==='/api/radio-directory'){if(req.method!=='GET')throw new PlatformError('invalid-request','Invalid directory request method',405);const value=await radioDirectory.page({scope:url.searchParams.get('scope'),query:url.searchParams.get('q')},Number(url.searchParams.get('offset') || 0),{force:url.searchParams.get('force')==='1'});await reply(res,200,value);return true;}
      if(url.pathname==='/api/qq-radios' || url.pathname==='/api/qq-radio-tracks'){if(req.method!=='GET')throw new PlatformError('invalid-request','Invalid station request method',405);const generation=session.generation,value=url.pathname==='/api/qq-radios'?await qqRadios(providers,session):await qqRadioTracks(providers,url.searchParams.get('id') || '',session);if(generation!==session.generation)throw new PlatformError('session-changed','Account changed. Retry',409);if(value.songs)remember(value.songs);await reply(res,200,value);return true;}
      if(url.pathname.startsWith('/api/radio-')){if(req.method!=='POST')throw new PlatformError('invalid-request','Invalid station request method',405);const input=await body(req);let value;
        if(url.pathname==='/api/radio-custom')value={station:customRadio(input)};
        else if(url.pathname==='/api/radio-source')value=radioSource(radioResources,radioDirectory,input,session);
        else if(url.pathname==='/api/radio-revoke'){radioResources.revoke(input.path,session.id);value={ok:true};}
        else if(url.pathname==='/api/radio-image'){let station;try{station=radioStation(input.station);}catch(error){throw new PlatformError('invalid-request',error.message,400);}if(!station.artworkUrl)throw new PlatformError('not-found','No station artwork',404);value={url:radioResources.register(station.artworkUrl,session.id,'artwork')};}
        else throw new PlatformError('not-found','Station endpoint not found',404);await reply(res,200,value);return true;}
      if(url.pathname==='/api/accounts' && req.method==='GET'){await reply(res,200,logins.accounts(session));return true;}
      if(url.pathname==='/api/lan' && req.method==='GET') {const heartbeat=url.searchParams.get('heartbeat')==='1';if(heartbeat)lan.check(session,{revision:url.searchParams.get('revision')});await reply(res,200,lan.state(session,{heartbeat}));return true;}
      if(url.pathname==='/api/lan/file') {await lan.download(session,{id:url.searchParams.get('id'),revision:url.searchParams.get('revision')},req,res);return true;}
      if(url.pathname.startsWith('/api/lan/')) {
        if(req.method!=='POST')throw new PlatformError('invalid-request','Unsupported transfer request method',405);
        const input=await body(req);let value;
        if(url.pathname==='/api/lan/start')value=await lan.start(session,input);
        else if(url.pathname==='/api/lan/stop')value=await lan.stop(session,input);
        else if(url.pathname==='/api/lan/ack')value=await lan.acknowledge(session,input);
        else throw new PlatformError('not-found','Transfer endpoint not found',404);
        await reply(res,200,value);return true;
      }
      if(url.pathname==='/api/webdav' && req.method==='GET'){await reply(res,200,webdav.state(session));return true;}
      if(url.pathname.startsWith('/api/webdav/')) {
        if(req.method!=='POST')throw new PlatformError('invalid-request','Unsupported handoff request method',405);
        const input=await body(req,url.pathname==='/api/webdav/publish'?140000:16384);let value;
        if(url.pathname==='/api/webdav/connect')value=await webdav.connect(session,input);
        else if(url.pathname==='/api/webdav/refresh')value=await webdav.refresh(session,input);
        else if(url.pathname==='/api/webdav/forget')value=webdav.forget(session,input);
        else if(url.pathname==='/api/webdav/publish' || url.pathname==='/api/webdav/claim')value=await webdav.mutate(session,url.pathname.slice(12),input);
        else throw new PlatformError('not-found','Handoff endpoint not found',404);
        await reply(res,200,value);return true;
      }
      if(url.pathname.startsWith('/api/login/') || url.pathname==='/api/account/check') {
        if(url.pathname==='/api/login/image' && req.method==='GET') {
          const image=logins.image(session,url.searchParams.get('id'));
          res.writeHead(200,{'Content-Type':'image/png','Content-Length':image.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(image);return true;
        }
        if(req.method!=='POST')throw new PlatformError('invalid-request','Unsupported sign-in request method',405);
        const input=await body(req);let value;
        if(url.pathname==='/api/login/start')value=await logins.start(session,input.source,input.method,input);
        else if(url.pathname==='/api/login/poll')value=await logins.poll(session,input.id);
        else if(url.pathname==='/api/login/cancel'){logins.cancel(input.id,session,input);value={ok:true};}
        else if(url.pathname==='/api/account/check')value=await logins.verify(session,input.source);
        else throw new PlatformError('not-found','Sign-in endpoint not found',404);
        await reply(res,200,value);return true;
      }
      if(url.pathname==='/api/account' && req.method==='POST') {
        const input=await body(req);
        if(!sources.includes(input.source) || typeof input.cookie!=='string' || input.cookie.length>12_000 || /[\r\n]/.test(input.cookie))throw new PlatformError('invalid-request','Invalid account session format',400);
        installAccount(session,input.source,input.cookie);
        await reply(res,200,{ok:true,connected:!!input.cookie});return true;
      }
      if(url.pathname==='/api/bili-action') {
        if(req.method!=='POST')throw new PlatformError('invalid-request','Unsupported interaction request method',405);
        const input=await body(req);await renewal.renew(session,'bili');const track=await getTrack(input.id,session);
        await reply(res,200,await biliActions.mutate(session,track,input));return true;
      }
      if(req.method!=='GET' && req.method!=='HEAD')throw new PlatformError('invalid-request','Unsupported request method',405);
      if(url.pathname==='/api/bili-actions') {
        await renewal.renew(session,'bili');
        const track=await getTrack(url.searchParams.get('id') || '',session);
        const read=()=>biliActions.state(session,track,{revision:url.searchParams.get('revision'),force:url.searchParams.get('force')==='1'});
        await reply(res,200,await (providers.withSession?providers.withSession('bili',session,read):read()));return true;
      }
      if(url.pathname==='/api/live-revoke'){liveResources.revoke(url.searchParams.get('path'),session.id);await reply(res,200,{ok:true});return true;}
      if(url.pathname.startsWith('/api/live-media/')){await liveResources.serve(req,res,url.pathname,session.id);return true;}
      if(url.pathname==='/api/live-room' || url.pathname==='/api/live-stream') {
        const generation=session.generation,id=url.searchParams.get('room') || '';
        const data=url.pathname==='/api/live-room'?await liveDetail(providers,id,session):await liveManifest(providers,id,Number(url.searchParams.get('quality') || 80),session);
        if(generation!==session.generation)throw new PlatformError('session-changed','Account changed. Retry',409);
        await reply(res,200,data.streams?{...data,streams:data.streams.map(({urls,...row})=>({...row,url:liveResources.register(urls[0],session.id)}))}:data);return true;
      }
      if(url.pathname==='/api/catalog') {
        if(!sources.includes(source))throw new PlatformError('invalid-request','Invalid platform',400);
        const query=url.searchParams.get('q') || '';const page=Number(url.searchParams.get('page') || 1),kind=url.searchParams.get('kind') || 'songs';
        if(!['songs','creators'].includes(kind) || query.length>200 || !Number.isSafeInteger(page) || page<1 || page>100)throw new PlatformError('invalid-request','Invalid search parameters',400);
        const generation=session.generation;
        const data=kind==='creators'?(query.trim()?await searchCreators(providers,source,query.trim(),page,session):{creators:[],total:0,more:false}):query.trim()?await providers.search(source,query.trim(),page,session):await providers.discover(source,session);
        if(generation!==session.generation)throw new PlatformError('session-changed','Account changed. Retry',409);
        if(data.songs)remember(data.songs);await reply(res,200,data.creators?{...data,creators:data.creators.map(row=>({...row,image:publicImage(source,row.avatarUrl),avatarUrl:undefined}))}:data);return true;
      }
      if(url.pathname==='/api/public-image') {
        const address=url.searchParams.get('address') || '',image=publicImage(source,address);
        if(!image)throw new PlatformError('invalid-request','Unsupported image source',400);
        await resource(req,res,[address],source,'image/jpeg',8*1024*1024,PUBLIC_IMAGE_HOSTS[source]);return true;
      }
      if(url.pathname==='/api/collection') {
        const generation=session.generation,data=await collection(providers,source,url.searchParams.get('id') || '',Number(url.searchParams.get('page') || 1),session);
        if(generation!==session.generation)throw new PlatformError('session-changed','Account changed. Retry',409);remember(data.songs);await reply(res,200,data);return true;
      }
      if(url.pathname==='/api/bili-presence') {
        if(req.method!=='GET')throw new PlatformError('invalid-request','Live status is read-only',405);
        const generation=session.generation;
        const value=await presence.read(session,{scope:url.searchParams.get('scope'),id:url.searchParams.get('id') || ''},{force:url.searchParams.get('refresh')==='1'});
        if(generation!==session.generation)throw new PlatformError('session-changed','Account changed. Retry',409);
        await reply(res,200,value);return true;
      }
      if(['/api/bili-feed','/api/bili-dynamic','/api/bili-followings'].includes(url.pathname)) {
        const generation=session.generation;
        const data=url.pathname==='/api/bili-feed'?await activityFeed(providers,{scope:url.searchParams.get('scope') || 'author',id:url.searchParams.get('id') || '',cursor:url.searchParams.get('cursor') || ''},session):url.pathname==='/api/bili-dynamic'?{activity:await activityDetail(providers,url.searchParams.get('id') || '',session)}:await followedCreators(providers,Number(url.searchParams.get('page') || 1),session);
        if(generation!==session.generation)throw new PlatformError('session-changed','Account changed. Retry',409);
        remember(activitySongs(data.activity?[data.activity]:data.items || []));await reply(res,200,data);return true;
      }
      if(url.pathname==='/api/creator' || url.pathname==='/api/creator-artwork') {
        const id=url.searchParams.get('id') || '',page=Number(url.searchParams.get('page') || 1);
        if(!validCreator(source,id) || !Number.isSafeInteger(page) || page<1 || page>100)throw new PlatformError('invalid-request','Invalid artist page parameters',400);
        const generation=session.generation;
        if(url.pathname==='/api/creator-artwork') {const address=source==='qq'?qqAvatar(id):(await creatorProfile(providers,source,id,session)).avatarUrl;if(generation!==session.generation)throw new PlatformError('session-changed','Account changed. Retry',409);if(!address)throw new PlatformError('not-found','No artist avatar',404);await resource(req,res,[address],source,'image/jpeg',8*1024*1024);return true;}
        if(url.searchParams.get('mode')==='profile') {const profile=await creatorProfile(providers,source,id,session);if(generation!==session.generation)throw new PlatformError('session-changed','Account changed. Retry',409);await reply(res,200,{profile,songs:[],more:false,total:0,page,warning:''});return true;}
        const [details,works]=await Promise.allSettled([creatorProfile(providers,source,id,session),creatorSongs(providers,source,id,page,session)]);
        if(details.status==='rejected' && works.status==='rejected')throw [details.reason,works.reason].find(e=>['verification','sign-in'].includes(e.code)) || details.reason;
        let songs=[],more=false,total=0,warning='',profile;
        if(works.status==='fulfilled')({songs,more,total}=works.value);else {if(!(works.reason instanceof PlatformError))throw works.reason;warning=works.reason.message;}
        if(details.status==='fulfilled')profile=details.value;else {
          if(!(details.reason instanceof PlatformError))throw details.reason;
          const known=[...catalog.values(),...songs].find(row=>row.source===source && row.creatorId===id);
          profile={source,id,name:known?.creatorName || known?.artist || (source==='bili'?'UP creator':'Artists'),description:'',avatarUrl:source==='qq'?qqAvatar(id):'',followers:0,partial:true};
          warning=`Profile not fully loaded：${details.reason.message}`;
        }
        if(generation!==session.generation)throw new PlatformError('session-changed','Account changed. Retry',409);
        remember(songs);await reply(res,200,{profile,songs,more,total,warning,page});return true;
      }
      if(url.pathname==='/api/media-state') {
        const match=/^\/api\/media\/([a-f0-9]{48})$/.exec(url.searchParams.get('path') || '');
        if(!match)throw new PlatformError('invalid-request','Invalid playback resource identifier',400);
        const entry=streams.get(match[1]);
        if(!entry || entry.session!==session.id || entry.expiry<now())throw new PlatformError('expired','Playback URL expired. Play again',410);
        const failure=entry.failure && now()-entry.failure.at<=30000?entry.failure:null;
        await reply(res,200,{failure});return true;
      }
      if(url.pathname.startsWith('/api/media/')) {
        const token=url.pathname.slice(11);const entry=streams.get(token);
        if(!entry || entry.session!==session.id || entry.expiry<now())throw new PlatformError('expired','Playback URL expired. Play again',410);
        try {await resource(req,res,entry.urls,entry.source,entry.type);}
        catch(error){
          entry.failure={code:error instanceof PlatformError?error.code:'network',message:error instanceof PlatformError?error.message:'Media connection interrupted. Retry later',status:error instanceof PlatformError?error.status:503,retryAfter:retryAfterSeconds(error.retryAfter),at:now()};
          throw error;
        }
        return true;
      }
      if(url.pathname==='/api/lyrics' && url.searchParams.get('provider')==='kugou') {
        const title=url.searchParams.get('title') || '',artist=url.searchParams.get('artist') || '',durationMs=Number(url.searchParams.get('duration'));
        if(!title.trim() || title.length>200 || !artist.trim() || artist.length>200 || !Number.isFinite(durationMs) || durationMs<0 || durationMs>86_400_000)throw new PlatformError('invalid-request','Invalid lyrics query details',400);
        await reply(res,200,await providers.kugouLyrics({title,artist,durationMs}));return true;
      }
      const id=url.searchParams.get('id') || '';
      if(url.pathname==='/api/comments' && id.startsWith('bili-dynamic-')) {
        const generation=session.generation,activity=await activityDetail(providers,id.slice(13),session);
        if(!activity.commentTarget)throw new PlatformError('unavailable','Comments are not available for this post');
        const data=await bilibiliReplies(providers,{...activity.commentTarget,owner:activity.authorId},{order:url.searchParams.get('order') || 'hot',cursor:url.searchParams.get('cursor') || '',root:url.searchParams.get('root') || ''},session);
        if(generation!==session.generation)throw new PlatformError('session-changed','Account changed. Retry',409);
        await reply(res,200,{...data,subject:{id,title:activity.title || activity.text.slice(0,100) || `${activity.author} posts`,artist:activity.author,source:'bili'}});return true;
      }
      let track=await getTrack(id,session);
      if(url.pathname==='/api/bili-context') {
        if(track.source!=='bili')throw new PlatformError('invalid-request','This content does not support video episodes',400);
        const generation=session.generation,data=await bilibiliContext(providers,track,session);
        if(generation!==session.generation)throw new PlatformError('session-changed','Account changed. Retry',409);
        remember([...data.parts.map(row=>row.song),...(data.collection?.songs || [])]);await reply(res,200,data);return true;
      }
      if(url.pathname==='/api/comments') {
        const generation=session.generation,data=await comments(providers,track,{order:url.searchParams.get('order') || 'hot',cursor:url.searchParams.get('cursor') || '',root:url.searchParams.get('root') || ''},session);
        if(generation!==session.generation)throw new PlatformError('session-changed','Account changed. Retry',409);await reply(res,200,data);return true;
      }
      if(url.pathname==='/api/video') {
        const quality=Number(url.searchParams.get('quality') || 80);if(track.source!=='bili' || !BILI_QUALITIES.includes(quality))throw new PlatformError('invalid-request','Invalid video or quality parameters',400);
        const generation=session.generation;const data=await biliVideo(providers,track,quality,session);if(generation!==session.generation)throw new PlatformError('session-changed','Account changed. Retry',409);
        await reply(res,200,{...data,streams:data.streams.map(({urls,...row})=>({...row,url:registerStream({urls,type:'video/mp4'},'bili',session,'video')}))});return true;
      }
      if(url.pathname==='/api/danmaku') {if(track.source!=='bili')throw new PlatformError('invalid-request','This content does not support scrolling comments',400);const generation=session.generation;const data=await biliDanmaku(providers,track,session);if(generation!==session.generation)throw new PlatformError('session-changed','Account changed. Retry',409);await reply(res,200,data);return true;}
      if(url.pathname==='/api/stream' || url.pathname==='/api/cache-stream') {
        if(req.method!=='GET')throw new PlatformError('invalid-request','Invalid audio source request method',405);
        const generation=session.generation;const data=await providers.stream(track,session);
        if(generation!==session.generation)throw new PlatformError('session-changed','Account changed. Retry',409);
        const urls=data.urls.filter(item=>safeHttps(item,MEDIA_HOSTS[track.source]));if(!urls.length)throw new PlatformError('invalid-response','The platform returned no trusted playback URL');
        await reply(res,200,{url:registerStream({...data,urls},track.source,session,url.pathname==='/api/cache-stream'?'download':'audio'),type:data.type,durationMs:data.durationMs || track.durationMs});return true;
      }
      if(url.pathname==='/api/lyrics') {await reply(res,200,await providers.lyrics(track,session));return true;}
      if(url.pathname==='/api/artwork') {
        if(!track.artworkUrl && providers.metadata){track=await providers.metadata(track,session);remember([track]);}
        const address=safeHttps(track.artworkUrl,ART_HOSTS[track.source]);if(!address)throw new PlatformError('not-found','No album artwork',404);
        await resource(req,res,[address],track.source,'image/jpeg',8*1024*1024);return true;
      }
      throw new PlatformError('not-found','Endpoint not found',404);
    } catch(error) {
      if(res.headersSent){if(!res.writableEnded)res.destroy();return true;}
      if(error.retryAfter)res.setHeader('Retry-After',String(error.retryAfter));
      await reply(res,error instanceof PlatformError?error.status:503,{error:{code:error.code || 'unavailable',message:error instanceof PlatformError?error.message:'Connection unavailable. Retry later'}});return true;
    }
  };
}

/* Protocol mappings ported from ArchiveTune's Android platform repositories.
 * ArchiveTune (2026), Rukamori and contributors. GPL-3.0; original notices retained. */
import { createHash, createCipheriv, createPublicKey, publicEncrypt, constants, randomInt } from 'node:crypto';
import { PlatformError, cleanText, safeHttps } from './upstream.mjs';
import { kugouLyrics } from './lyrics.mjs';
import {loadBilibiliSegment} from './bilibili-segment.mjs';
import {bilibiliPartId} from '../web/bilibili-id.mjs';

export const MEDIA_HOSTS = { qq: ['stream.qqmusic.qq.com', 'qqmusic.qq.com', 'music.tc.qq.com', 'aqqmusic.tc.qq.com'], bili: ['bilivideo.com', 'bilivideo.cn', 'akamaized.net', 'bilibili.com'], netease: ['music.126.net', 'music.163.com'] };
export const ART_HOSTS = { qq: ['y.gtimg.cn'], bili: ['hdslb.com'], netease: ['music.126.net'] };
const REFERER = { qq: 'https://y.qq.com/', bili: 'https://www.bilibili.com/', netease: 'https://music.163.com/', kugou: 'https://www.kugou.com/' };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132.0.0.0 Safari/537.36';
const md5 = text => createHash('md5').update(text).digest('hex');
const cookieValue = (value, name) => String(value || '').split(';').map(row => row.trim()).find(row => row.startsWith(name + '='))?.slice(name.length + 1) || '';
const gtk = text => { let hash = 5381; for (const char of text) hash += (hash << 5) + char.charCodeAt(0); return hash & 0x7fffffff; };
const pageSize = 20;
const sessionIdentity=session=>session?.id?`${session.id}:${session.generation || 0}:${session.authRevision || 0}`:'anonymous';
const success = (data, wanted = 0) => { if (data.code !== wanted) throw new PlatformError('unavailable', 'The platform returned no available content'); return data; };
export function mapQq(row) {
  const mid = row.mid || row.songmid; if (!/^[a-zA-Z0-9]{5,32}$/.test(mid || '')) return null;
  const albumMid = row.album?.mid || row.albummid;
  const creatorId=String(row.singer?.[0]?.mid || row.singer?.[0]?.singermid || '');
  return { id: `qq-${mid}`, remoteId: mid, source: 'qq', creatorName:cleanText(row.singer?.[0]?.name), creatorId:/^[A-Za-z0-9]{5,32}$/.test(creatorId)?creatorId:'', title: cleanText(row.title || row.name || row.songname), artist: (row.singer || []).map(s => cleanText(s.name)).join('、') || 'Unknown artist', album: cleanText(row.album?.title || row.album?.name || row.albumname), durationMs: (Number(row.interval) || 0) * 1000, artworkUrl: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : '', mediaMid: row.file?.media_mid || row.mediaMid || '', songId: Number(row.id || row.songid) || 0, songType: Number(row.type || row.songtype) || 0, favorite: false, hasArtwork: !!albumMid };
}
export function mapBili(row) {
  if (!/^BV[a-zA-Z0-9]{10}$/.test(row.bvid || '')) return null;
  const seconds = typeof row.duration === 'string' && row.duration.includes(':') ? row.duration.split(':').reduce((total, part) => total * 60 + Number(part), 0) : Number(row.duration);
  const cover = safeHttps(row.pic, ART_HOSTS.bili) || '';
  const creatorId=String(row.owner?.mid || row.mid || '');
  return { id: `bili-${row.bvid}`, remoteId: row.bvid, source: 'bili', creatorName:cleanText(row.author || row.owner?.name), creatorId:/^[1-9]\d{0,18}$/.test(creatorId)?creatorId:'', title: cleanText(row.title), artist: cleanText(row.author || row.owner?.name || 'Bilibili UP creator'), album: '', durationMs: (seconds || 0) * 1000, artworkUrl: cover, favorite: false, hasArtwork: !!cover };
}
export function mapNetease(row) {
  if (!Number.isSafeInteger(row.id) || row.id <= 0) return null;
  const cover = safeHttps((row.al || row.album)?.picUrl, ART_HOSTS.netease) || '';
  const creatorId=String((row.ar || row.artists)?.[0]?.id || '');
  return { id: `netease-${row.id}`, remoteId: String(row.id), source: 'netease', creatorName:cleanText((row.ar || row.artists)?.[0]?.name), creatorId:/^[1-9]\d{0,18}$/.test(creatorId)?creatorId:'', title: cleanText(row.name), artist: (row.ar || row.artists || []).map(s => cleanText(s.name)).join('、') || 'Unknown artist', album: cleanText((row.al || row.album)?.name), durationMs: Number(row.dt || row.duration) || 0, artworkUrl: cover, favorite: false, hasArtwork: !!cover };
}
export function mapBiliPart(view,part,index) {
  const base=mapBili(view),cid=String(part?.cid || '');
  if(!base || !/^[1-9]\d{0,18}$/.test(cid) || typeof part.cid==='number' && !Number.isSafeInteger(part.cid))return null;
  const remoteId=index===0?base.remoteId:bilibiliPartId(base.remoteId,cid);if(!remoteId)return null;
  const number=Number.isSafeInteger(part.page) && part.page>0?part.page:index+1;
  return {...base,id:'bili-'+remoteId,remoteId,title:(view.pages?.length || 0)>1?`P${number} · ${cleanText(part.part) || base.title}`:base.title,album:base.title,durationMs:Math.max(0,Math.min(2592000,Number(part.duration) || 0))*1000};
}
const RSA_PUBLIC = createPublicKey({ key: Buffer.from('MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB', 'base64'), type: 'spki', format: 'der' });
export function neteaseForm(data, secret) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  secret ||= Array.from({ length: 16 }, () => alphabet[randomInt(alphabet.length)]).join('');
  if (!/^[A-Za-z0-9]{16}$/.test(secret)) throw new TypeError('Invalid protocol key');
  const aes = (text, key) => { const cipher = createCipheriv('aes-128-cbc', key, '0102030405060708'); return Buffer.concat([cipher.update(text), cipher.final()]).toString('base64'); };
  const inner = aes(JSON.stringify(data), '0CoJUm6Qyw8W8jud');
  const reversed = Buffer.from([...secret].reverse().join(''));
  const block = Buffer.alloc(128); reversed.copy(block, block.length - reversed.length);
  return new URLSearchParams({ params: aes(inner, secret), encSecKey: publicEncrypt({ key: RSA_PUBLIC, padding: constants.RSA_NO_PADDING }, block).toString('hex') });
}

export class PlatformProviders {
  constructor(governor) { this.net = governor; this.biliKey = ''; this.biliExpiry = 0; this.guid = String(randomInt(1000000000, 9999999999)); this.qqSearches=new Map(); }
  headers(source, cookie = '') { return { 'User-Agent': UA, Referer: REFERER[source], ...(cookie ? { Cookie: cookie } : {}) }; }
  async withSession(source,session,read){
    const generation=session?.generation;
    await this.renewal?.renew(session,source);
    if(session?.generation!==generation)throw new PlatformError('session-changed','Account changed. Retry',409);
    const usedCookie=session?.cookies?.[source];
    try{return await read();}catch(error){
      if(error.code!=='sign-in' || !session?.cookies?.[source] || !this.renewal)throw error;
      if(session.cookies[source]===usedCookie)await this.renewal.renew(session,source,{force:true});
      if(session.generation!==generation)throw new PlatformError('session-changed','Account changed. Retry',409);
      if(session.cookies[source]===usedCookie)throw error;
      return read();
    }
  }
  qq(module,method,param,session,commOverride,mobile=false){return this.withSession('qq',session,()=>this.qqRead(module,method,param,session,commOverride,mobile));}
  async qqRead(module, method, param, session, commOverride, mobile=false) {
    const cookie = session?.cookies.qq || ''; const uin = (cookieValue(cookie, 'qqmusic_uin') || cookieValue(cookie, 'uin') || '0').replace(/^o/, '');
    const key = cookieValue(cookie, 'qqmusic_key') || cookieValue(cookie, 'qm_keyst');
    const comm = {...(commOverride || { ct: mobile?'11':'24', cv: mobile?'14090008':'4747474', ...(mobile?{v:'14090008',chid:'10003505',tmeAppID:'qqmusic',qq:uin}:{platform:'yqq.json'}),format:'json',inCharset:'utf-8',outCharset:'utf-8',notice:'0',needNewCode:'1'}),uin,g_tk:gtk(key),g_tk_new_20200303:gtk(key),...(key?{authst:key,tmeLoginType:['0','1','2'].includes(cookieValue(cookie,'login_type'))?Number(cookieValue(cookie,'login_type')):key.startsWith('W_X')?1:2}:{})};
    const root = success(await this.net.json('qq', 'https://u.y.qq.com/cgi-bin/musicu.fcg', { method: 'POST', headers: { ...this.headers('qq', cookie), 'Content-Type': 'application/json' }, body: JSON.stringify({ comm, req_0: { module, method, param } }) }, 60_000, sessionIdentity(session)));
    const result = root.req_0;
    if ([1000,104400,104401].includes(result?.code)) throw new PlatformError('sign-in', 'QQ Music session expired. Reconnect the account', 401);
    if (result?.code !== 0 || !result.data) throw new PlatformError('unavailable', `QQ Music does not provide this content ${result?.code ? `（${result.code}）` : ''}`);
    return result.data;
  }
  async netease(path, data, session) {
    const cookie = session?.cookies.netease || '';
    const form = neteaseForm({ ...data, csrf_token: cookieValue(cookie, '__csrf') });
    return success(await this.net.json('netease', 'https://music.163.com' + path.replace('/api/', '/weapi/'), { method: 'POST', headers: { ...this.headers('netease', cookie), 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() }, 60_000, sessionIdentity(session)), 200);
  }
  biliLive(path,query,session,signed=false) {return this.bili(path,query,session,signed,true);}
  bili(path,query,session,signed=false,live=false,options={}){return this.withSession('bili',session,()=>this.biliRead(path,query,session,signed,live,options));}
  async biliRead(path, query, session, signed = false, live=false,{signal,fresh=false,ttl=live?3000:60000}={}) {
    const origin=live?'https://api.live.bilibili.com':'https://api.bilibili.com';
    const cookie = session?.cookies.bili || '';
    if (signed) {
      if (!this.biliKey || Date.now() > this.biliExpiry) {
        const nav = await this.net.json('bili', 'https://api.bilibili.com/x/web-interface/nav', { headers: this.headers('bili', cookie),signal }, 1_800_000, sessionIdentity(session), [-101]);
        const image = nav.data?.wbi_img;
        const source = [image?.img_url,image?.sub_url].map(url => String(url || '').split('/').pop().split('.')[0]).join('');
        if (!/^[a-fA-F0-9]{64}$/.test(source)) throw new PlatformError('invalid-response', 'Bilibili Request identifier unavailable');
        const permutation = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13];
        this.biliKey = permutation.map(i => source[i]).join(''); this.biliExpiry = Date.now() + 1_800_000;
      }
      query = { ...query, wts: Math.floor(Date.now() / 1000) };
      const canonical = Object.keys(query).sort().map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(query[key]).replace(/[!'()*]/g,''))}`).join('&');
      signal?.throwIfAborted();
      return success(await this.net.json('bili', `${origin}${path}?${canonical}&w_rid=${md5(canonical + this.biliKey)}`, { headers: {...this.headers('bili', cookie),...(live?{Referer:'https://live.bilibili.com/'}:{})},signal,...(fresh?{cache:'no-store'}:{}) }, ttl, sessionIdentity(session)));
    }
    return success(await this.net.json('bili', `${origin}${path}?${new URLSearchParams(query)}`, { headers: {...this.headers('bili', cookie),...(live?{Referer:'https://live.bilibili.com/'}:{})},signal,...(fresh?{cache:'no-store'}:{}) }, ttl, sessionIdentity(session)));
  }
  async search(source, term, page = 1, session) {
    if (source === 'qq') {
      const key=`${sessionIdentity(session)}|${term}`;
      if(!this.qqSearches.has(key)){this.qqSearches.set(key,{id:String(Date.now()*1000),next:{}});while(this.qqSearches.size>100)this.qqSearches.delete(this.qqSearches.keys().next().value)}
      const cursor=this.qqSearches.get(key);
      const data = await this.qq('music.adaptor.SearchAdaptor', 'do_search_v2', { searchid: cursor.id, search_type: 100, page_num: pageSize, query: term, page_id: page,highlight:0,grp:1,...(cursor.next[page]?{page_start:cursor.next[page]}:{}) }, session);
      const area = data.body?.item_song || data.body?.song || data.song || {};
      const songs = (area.items || area.list || area.songlist || []).map(mapQq).filter(Boolean);
      if(data.meta?.nextpage_start && data.meta.nextpage>page)cursor.next[data.meta.nextpage]=data.meta.nextpage_start;
      return { songs, total: area.total_num || area.sum || area.totalnum || songs.length, more: songs.length>0 && data.meta?.nextpage>page };
    }
    if (source === 'bili') {
      const root = await this.bili('/x/web-interface/wbi/search/type', { keyword: term, search_type: 'video', page, page_size: pageSize }, session, true);
      return { songs: (root.data?.result || []).map(mapBili).filter(Boolean), total: root.data?.numResults || 0, more: page < root.data?.numPages };
    }
    const root = await this.netease('/api/cloudsearch/pc', { s: term, type: 1, limit: pageSize, offset: (page - 1) * pageSize, total: true }, session);
    return { songs: (root.result?.songs || []).map(mapNetease).filter(Boolean), total: root.result?.songCount || 0, more: page * pageSize < root.result?.songCount };
  }
  async discover(source, session) {
    if (source === 'qq') { const data = await this.qq('music.musicToplist.Toplist','GetDetail',{topId:26,offset:0,num:12,withTags:true},session); return { songs: (data.songInfoList || []).map(mapQq).filter(Boolean), more:false }; }
    if (source === 'bili') { const root = await this.bili('/x/web-interface/region/feed/rcmd',{from_region:1003,request_cnt:12,display_id:1},session); return { songs:(root.data?.archives || []).map(mapBili).filter(Boolean),more:false }; }
    const root = await this.netease('/api/personalized/newsong',{limit:12},session);
    return { songs:(root.result || []).map(row => mapNetease(row.song || row)).filter(Boolean),more:false };
  }
  async metadata(track,session) {
    let value;
    if(track.source==='qq'){const data=await this.qq('music.pf_song_detail_svr','get_song_detail_yqq',{song_mid:track.remoteId},session);value=mapQq(data.track_info || {});}
    else if(track.source==='bili'){const {view,part,index}=await loadBilibiliSegment(this,track,session);const mapped=mapBiliPart(view,part,index);value=mapped?{...mapped,id:track.id,remoteId:track.remoteId}:null;}
    else {const root=await this.netease('/api/v3/song/detail',{c:JSON.stringify([{id:Number(track.remoteId)}]),ids:JSON.stringify([Number(track.remoteId)])},session);value=mapNetease(root.songs?.[0] || {});}
    if(!value || value.id!==track.id)throw new PlatformError('not-found','Track metadata unavailable',404);
    return value;
  }
  kugouLyrics(track) {return kugouLyrics(this.net,track,this.headers('kugou'));}
  async stream(track, session) {
    const source = track.source;
    if (source === 'bili') {
      const {bvid,cid} = await loadBilibiliSegment(this,track,session);
      const root = await this.bili('/x/player/wbi/playurl',{bvid,cid,qn:64,fnval:4048,fnver:0,fourk:1},session,true);
      const audio = root.data?.dash?.audio?.slice().sort((a,b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
      const urls = [audio?.baseUrl || audio?.base_url,...(audio?.backupUrl || audio?.backup_url || [])].map(url => safeHttps(url,MEDIA_HOSTS.bili)).filter(Boolean);
      if (!urls.length) throw new PlatformError('rights','This video has no playable audio. Check sign-in and content access',401);
      return { urls:urls.slice(0,2),type:'audio/mp4',cid,durationMs:Math.floor((root.data.dash.duration || 0)*1000) };
    }
    if (source === 'qq') {
      let mid = track.mediaMid;
      if (!mid) { const data = await this.qq('music.pf_song_detail_svr','get_song_detail_yqq',{song_mid:track.remoteId},session); mid = data.track_info?.file?.media_mid || track.remoteId + track.remoteId; }
      const cookie=session?.cookies.qq || '';const uin=(cookieValue(cookie,'qqmusic_uin') || cookieValue(cookie,'uin') || '0').replace(/^o/,''); const key=cookieValue(cookie,'qm_keyst') || cookieValue(cookie,'qqmusic_key');
      const data = await this.qq('music.vkey.GetVkey','UrlGetVkey',{uin,guid:this.guid,ctx:0,filename:[`M500${mid}.mp3`],songmid:[track.remoteId],songtype:[track.songType || 0]},session,{ct:19,cv:2201,uin,authst:key,tmeLoginType:key ? key.startsWith('W_X') ? 1 : 2 : 0});
      const item = data.midurlinfo?.find(row => row.purl && (!row.result || row.result===0));
      if (!item) throw new PlatformError('rights','QQ Music returned no playback URL. Connect an account with track access',401);
      const bases=data.sip?.length?data.sip:['https://isure.stream.qqmusic.qq.com/'];
      const urls=bases.map(base => {try{return safeHttps(new URL(item.purl,base).href,MEDIA_HOSTS.qq)}catch{return null}}).filter(Boolean);
      if(!urls.length)throw new PlatformError('invalid-response','Playback URL does not match allowed platform hosts');
      return {urls:urls.slice(0,2),type:'audio/mpeg'};
    }
    const root = await this.netease('/api/song/enhance/player/url/v1',{ids:JSON.stringify([Number(track.remoteId)]),level:'standard',encodeType:'aac'},session);
    const song=root.data?.find(row => String(row.id)===track.remoteId);const url=safeHttps(song?.url,MEDIA_HOSTS.netease);
    if(!url || song?.code!==200)throw new PlatformError('rights','NetEase returned no playback URL. Check account and content access',401);
    return {urls:[url],type:song.type==='mp3'?'audio/mpeg':'audio/mp4'};
  }
  async lyrics(track, session) {
    if(track.source==='qq') { const data=await this.qq('music.musichallSong.PlayLyricInfo','GetPlayLyricInfo',{songMID:track.remoteId,songID:track.songId || 0,crypt:0,interval:Math.floor(track.durationMs/1000)},session); const raw=data.lyric || '';return {text:raw.startsWith('[')?raw:Buffer.from(raw,'base64').toString('utf8'),source:'qq'}; }
    if(track.source==='netease') {const root=await this.netease('/api/song/lyric',{id:Number(track.remoteId),lv:-1,kv:-1,tv:-1},session);return {text:root.lrc?.lyric || '',source:'netease'};}
    const {bvid,cid}=await loadBilibiliSegment(this,track,session);
    const root=await this.bili('/x/player/wbi/v2',{bvid,cid},session,true);
    const subtitle=root.data?.subtitle?.subtitles?.slice().sort((a,b)=>Number(!a.lan?.startsWith('zh'))-Number(!b.lan?.startsWith('zh')))[0];
    const url=safeHttps(subtitle?.subtitle_url,['hdslb.com']);if(!url)return {text:'',source:'bili'};
    const data=await this.net.json('bili',url,{headers:this.headers('bili')},300_000,sessionIdentity(session));
    const text=(data.body || []).slice(0,4000).filter(row => Number.isFinite(row.from) && row.from>=0 && typeof row.content==='string').map(row=>{const ms=Math.floor(row.from*1000);return `[${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}]${cleanText(row.content)}`}).join('\n');
    return {text,source:'bili'};
  }
}

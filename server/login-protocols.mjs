/* QQ and NetEase contracts adapted from Android account repositories (GPL-3.0).
 * Bilibili web QR routes/states verified against the official passport login bundle. */
import {createHash,createCipheriv,randomUUID} from 'node:crypto';
import {PlatformError,cleanText,safeHttps} from './upstream.mjs';
import {biliWebCredential,qqCredential} from './session-credentials.mjs';

const unavailable=message=>new PlatformError('invalid-response',message || 'Incomplete sign-in response. Request a new QR code');
const validKey=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
const validValue=value=>typeof value==='string' && value.length>0 && value.length<=4096 && !/[\x00-\x20\x7f;"\\]/.test(value);
export function cookieValues(headers,address) {
  const origin=new URL(address),values=Object.create(null);
  const rows=(headers.getSetCookie?.() || [headers.get('set-cookie') || '']).flatMap(row=>row.split(/,(?=\s*[A-Za-z0-9_]+=)/));
  for(const row of rows.slice(0,64)) {
    const parts=row.split(';'),first=parts.shift(),at=first.indexOf('=');if(at<1)continue;
    const name=first.slice(0,at).trim(),value=first.slice(at+1).trim();
    const domain=parts.map(p=>/^\s*domain=(.*)$/i.exec(p)?.[1]?.trim().replace(/^\./,'').toLowerCase()).find(Boolean);
    if(domain && origin.hostname!==domain && !origin.hostname.endsWith('.'+domain))continue;
    if(!/^[A-Za-z0-9_]{1,64}$/.test(name) || !validValue(value) || parts.some(p=>/^\s*max-age=0\s*$/i.test(p)))continue;
    values[name]=value;
  }
  return values;
}
export function cookieHeader(values) {
  const text=Object.entries(values).filter(([name,value])=>/^[A-Za-z0-9_]{1,64}$/.test(name) && validValue(value)).map(([k,v])=>`${k}=${v}`).join('; ');
  if(text.length>12000)throw unavailable('Sign-in session is too large. Retry');return text;
}
export function neteaseEapi(path,data) {
  const json=JSON.stringify(data),digest=createHash('md5').update(`nobody${path}use${json}md5forencrypt`).digest('hex');
  const cipher=createCipheriv('aes-128-ecb','e82ckenh8dichen8',null);
  return new URLSearchParams({params:Buffer.concat([cipher.update(`${path}-36cd479b6b5-${json}-36cd479b6b5-${digest}`),cipher.final()]).toString('hex').toUpperCase()});
}
export function hash33(value,seed=0) {let h=seed;for(const char of value)h=(h+(h<<5)+char.charCodeAt(0))|0;return h&0x7fffffff;}
export function qqCallback(text) {
  if(typeof text!=='string' || text.length>4096)throw unavailable('QQ Invalid QR scan status');
  const match=/^\s*ptuiCB\(([^\r\n]*)\);?\s*$/.exec(text);
  if(!match)throw unavailable('QQ Invalid QR scan status');
  if(!/^\s*'(?:[^'\\]|\\['\\])*'(?:\s*,\s*'(?:[^'\\]|\\['\\])*')*\s*$/.test(match[1]))throw unavailable('QQ Invalid QR scan status');
  const args=[...match[1].matchAll(/'((?:[^'\\]|\\['\\])*)'/g)].map(m=>m[1].replace(/\\(['\\])/g,'$1'));
  if(args.length<3 || !/^\d{1,3}$/.test(args[0]))throw unavailable('QQ Invalid QR scan status');return args;
}
export function checkedQrPng(bytes) {
  if(!(bytes instanceof Uint8Array) || bytes.length<100 || bytes.length>500000)throw unavailable('Invalid QR image');
  const b=Buffer.from(bytes);if(!b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || b.toString('ascii',12,16)!=='IHDR')throw unavailable('Invalid QR image');
  const w=b.readUInt32BE(16),h=b.readUInt32BE(20);if(w<21 || h<21 || w>1024 || h>1024 || w*h>1048576)throw unavailable('Invalid QR image dimensions');return b;
}
function requireCode(body,code) {if(body.code!==code)throw new PlatformError('unavailable','The platform has not completed sign-in. Retry manually');return body;}
function validLoginUrl(value,hosts) {const url=typeof value==='string' && value.startsWith('https://') && value.length<=2048?safeHttps(value,hosts):null;if(!url)throw unavailable('Invalid sign-in QR URL');return url;}
function bilibiliQrUrl(value,key) {
  const hosts=['passport.bilibili.com','www.bilibili.com','account.bilibili.com'];
  const address=validLoginUrl(value,hosts),url=new URL(address);
  if(!hosts.includes(url.hostname))throw unavailable('Invalid sign-in QR URL');
  // The official web generate route now returns the account H5 landing page.
  // Its QR key must still belong to this exact passport polling challenge.
  if(url.hostname==='account.bilibili.com' && (url.pathname!=='/h5/account-h5/auth/scan-web' || url.hash || url.searchParams.getAll('qrcode_key').length!==1 || url.searchParams.get('qrcode_key')!==key))throw unavailable('QR code does not match this session. Request another');
  return address;
}

/** Fixed protocol destinations; only transient OAuth values stay in the private challenge record. */
export class LoginProtocols {
  constructor(providers,{now=Date.now}={}) {this.providers=providers;this.net=providers.net;this.now=now;}
  request(record,url,options={},format='json',codes=[]) {
    const headers={...this.providers.headers(record.source),...options.headers};
    return this.net.reply(record.source,url,{...options,headers,signal:record.controller.signal},'login:'+record.id,format,codes);
  }
  async start(record) {
    if(record.source==='bili') {
      const address='https://passport.bilibili.com/x/passport-login/web/qrcode/generate';
      const {body}=await this.request(record,address);requireCode(body,0);
      if(!validKey(body.data?.qrcode_key))throw unavailable();record.key=body.data.qrcode_key;
      return {url:bilibiliQrUrl(body.data.url,record.key)};
    }
    if(record.source==='netease') {
      const result=await this.netease(record,'/api/login/qrcode/unikey',{type:3});requireCode(result.body,200);
      const key=result.body.unikey || result.body.data?.unikey;if(!validKey(key))throw unavailable();record.key=key;
      return {url:'https://music.163.com/login?codekey='+encodeURIComponent(key)};
    }
    const query=new URLSearchParams({appid:'716027609',e:'2',l:'M',s:'3',d:'72',v:'4',t:String(Math.random()),daid:'383',pt_3rd_aid:'100497308'});
    const address='https://ssl.ptlogin2.qq.com/ptqrshow?'+query;
    const result=await this.request(record,address,{headers:{Referer:'https://xui.ptlogin2.qq.com/'}},'bytes');
    const cookies=cookieValues(result.headers,address);if(!validValue(cookies.qrsig) || cookies.qrsig.length>512)throw unavailable('QQ Invalid QR session');record.key=cookies.qrsig;
    return {image:checkedQrPng(result.body)};
  }
  async netease(record,path,data) {
    record.device ||= randomUUID();record.cookies ||= {};
    const header={os:'pc',appver:'3.1.3.203419',deviceId:record.device,versioncode:'140',channel:'netease',resolution:'1920x1080',requestId:Date.now()+'_0000',__csrf:record.cookies.__csrf || ''};
    for(const name of ['MUSIC_U','MUSIC_A','NMTID'])if(record.cookies[name])header[name]=record.cookies[name];
    const address='https://interfacepc.music.163.com'+path.replace('/api/','/eapi/');
    const result=await this.request(record,address,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Cookie:cookieHeader(header)},body:neteaseEapi(path,{...data,e_r:false,header}).toString()},'json',[800,801,802,803]);
    Object.assign(record.cookies,cookieValues(result.headers,address));return result;
  }
  async poll(record) {
    if(record.source==='bili') {
      const address='https://passport.bilibili.com/x/passport-login/web/qrcode/poll?'+new URLSearchParams({qrcode_key:record.key});
      const result=await this.request(record,address);requireCode(result.body,0);const code=result.body.data?.code;
      if(code===86101)return {status:'waiting'};if(code===86090)return {status:'scanned'};if(code===86038)return {status:'expired'};
      if(code!==0)throw unavailable('Bilibili QR sign-in not confirmed');
      const cookies=cookieValues(result.headers,address);
      if(!validValue(cookies.SESSDATA) || !/^[1-9]\d{0,18}$/.test(cookies.DedeUserID || '') || !/^[a-fA-F0-9]{32}$/.test(cookies.bili_jct || ''))throw unavailable('Bilibili Returned session is incomplete');
      return {status:'authorized',cookie:cookieHeader(cookies),credential:biliWebCredential(result.body.data,cookies,this.now())};
    }
    if(record.source==='netease') {
      const {body}=await this.netease(record,'/api/login/qrcode/client/login',{key:record.key,type:3});
      if(body.code===801)return {status:'waiting'};if(body.code===802)return {status:'scanned'};if(body.code===800)return {status:'expired'};
      if(body.code!==803 || !validValue(record.cookies.MUSIC_U))throw unavailable('NetEase returned an incomplete sign-in session');
      return {status:'authorized',cookie:cookieHeader(record.cookies)};
    }
    const q=new URLSearchParams({u1:'https://graph.qq.com/oauth2.0/login_jump',ptqrtoken:String(hash33(record.key)),ptredirect:'0',h:'1',t:'1',g:'1',from_ui:'1',ptlang:'2052',action:'0-0-'+Date.now(),js_ver:'20102616',js_type:'1',pt_uistyle:'40',aid:'716027609',daid:'383',pt_3rd_aid:'100497308',has_onekey:'1'});
    const result=await this.request(record,'https://ssl.ptlogin2.qq.com/ptqrlogin?'+q,{headers:{Referer:'https://xui.ptlogin2.qq.com/',Cookie:'qrsig='+record.key}},'text');
    const args=qqCallback(result.body),code=Number(args[0]);
    if(code===66)return {status:'waiting'};if(code===67)return {status:'scanned'};if(code===65)return {status:'expired'};if(code===68)return {status:'refused'};
    if(code!==0)throw unavailable('QQ QR sign-in not confirmed');
    const redirect=validLoginUrl(args[2],['graph.qq.com','ssl.ptlogin2.graph.qq.com','ssl.ptlogin2.qq.com']),url=new URL(redirect),uin=url.searchParams.get('uin'),sig=url.searchParams.get('ptsigx');
    if(!/^[1-9]\d{0,18}$/.test(uin || '') || !validValue(sig) || sig.length>2048)throw unavailable('QQ Invalid authorization result');
    return this.qqAuthorize(record,uin,sig);
  }
  async qqAuthorize(record,uin,sig) {
    const q=new URLSearchParams({uin,pttype:'1',service:'ptqrlogin',nodirect:'0',ptsigx:sig,s_url:'https://graph.qq.com/oauth2.0/login_jump',ptlang:'2052',ptredirect:'100',aid:'716027609',daid:'383',j_later:'0',low_login_hour:'0',regmaster:'0',pt_login_type:'3',pt_aid:'0',pt_aaid:'16',pt_light:'0',pt_3rd_aid:'100497308'});
    const address='https://ssl.ptlogin2.graph.qq.com/check_sig?'+q;
    const check=await this.request(record,address,{headers:{Referer:'https://xui.ptlogin2.qq.com/'}},'bytes'),cookies=cookieValues(check.headers,address);
    if(!validValue(cookies.p_skey))throw unavailable('QQ Invalid authorization details');
    const state=randomUUID(),form=new URLSearchParams({response_type:'code',client_id:'100497308',redirect_uri:'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/',scope:'get_user_info,get_app_friends',state,switch:'',from_ptlogin:'1',src:'1',update_auth:'1',openapi:'1010_1030',g_tk:String(hash33(cookies.p_skey,5381)),auth_time:String(Date.now()),ui:randomUUID()});
    const auth=await this.request(record,'https://graph.qq.com/oauth2.0/authorize',{method:'POST',headers:{Cookie:cookieHeader(cookies),'Content-Type':'application/x-www-form-urlencoded'},body:form.toString()},'bytes');
    const target=new URL(validLoginUrl(auth.headers.get('location'),['y.qq.com']));
    if(target.hostname!=='y.qq.com' || target.pathname!=='/portal/wx_redirect.html' || target.searchParams.getAll('state').length!==1 || target.searchParams.get('state')!==state || target.searchParams.getAll('code').length!==1)throw unavailable('QQ Invalid sign-in callback');
    const code=target.searchParams.get('code');if(!validValue(code))throw unavailable('QQ Sign-in returned no authorization code');
    const envelope={comm:{ct:24,cv:4747474,platform:'yqq.json',chid:'0',uin:0,g_tk:5381,g_tk_new_20200303:5381,format:'json',inCharset:'utf-8',outCharset:'utf-8',notice:0,needNewCode:1,tmeLoginType:2},req_0:{module:'QQConnectLogin.LoginServer',method:'QQLogin',param:{code}}};
    const result=await this.request(record,'https://u.y.qq.com/cgi-bin/musicu.fcg',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(envelope)});requireCode(result.body,0);
    const answer=result.body.req_0;if(answer?.code!==0 || answer.data?.code && answer.data.code!==0)throw new PlatformError('sign-in','QQ Music authorization incomplete. Check the official app',401);
    const rawId=answer.data?.str_musicid || answer.data?.musicid || '';
    const id=typeof rawId==='number'?(Number.isSafeInteger(rawId)?String(rawId):''):rawId,key=answer.data?.musickey;
    if(!/^[1-9]\d{0,18}$/.test(id) || !validValue(key) || key.length<8)throw unavailable('QQ Music returned an incomplete sign-in session');
    return {status:'authorized',cookie:cookieHeader({uin:id,qqmusic_uin:id,qm_keyst:key,qqmusic_key:key,login_type:'2'}),credential:qqCredential(answer.data,2,this.now())};
  }
  async profile(source,session) {
    const cookie=session.cookies[source];if(!cookie)throw new PlatformError('sign-in','Sign in to this platform first',401);
    if(source==='bili') {
      // AccountLogins owns verification/renewal retries; do not nest the general read retry here.
      const read=this.providers.biliRead || this.providers.bili;
      const root=await read.call(this.providers,'/x/web-interface/nav',{},session),data=root.data;
      if(!data?.isLogin)throw new PlatformError('sign-in','Bilibili Session expired',401);return {name:cleanText(data.uname || 'Bilibili account',80)};
    }
    if(source==='netease') {
      const root=await this.providers.netease('/api/w/nuser/account/get',{},session);
      if(!root.profile?.nickname)throw new PlatformError('sign-in','NetEase session expired',401);return {name:cleanText(root.profile.nickname,80)};
    }
    const values=Object.fromEntries(cookie.split(';').map(row=>row.trim().split(/=(.*)/s).slice(0,2))),uin=(values.qqmusic_uin || values.uin || '').replace(/^o/,''),key=values.qqmusic_key || values.qm_keyst;
    if(!/^[1-9]\d{0,18}$/.test(uin) || !validValue(key))throw new PlatformError('sign-in','QQ Music session expired',401);
    const q=new URLSearchParams({ct:'20',format:'json',inCharset:'utf-8',outCharset:'utf-8',notice:'0',platform:'yqq.json',needNewCode:'0',g_tk:String(hash33(key,5381)),cid:'205360838',loginUin:uin,hostUin:'0',userid:uin,reqfrom:'1'});
    const root=await this.net.json('qq','https://c6.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg?'+q,{headers:this.providers.headers('qq',cookie)},60000,session.id+':'+session.generation+':'+(session.authRevision || 0));requireCode(root,0);
    return {name:cleanText(root.data?.creator?.nick || root.data?.nick || root.data?.nickname || 'QQ Music account',80)};
  }
}

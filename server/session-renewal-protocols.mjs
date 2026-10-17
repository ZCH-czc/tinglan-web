/* Web counterparts of Android PlatformSessionRenewal. Fixed provider destinations only. */
import {createPublicKey,publicEncrypt,constants} from 'node:crypto';
import {PlatformError} from './upstream.mjs';
import {cookieValues,cookieHeader,hash33} from './login-protocols.mjs';
import {qqCredential,qqCredentialCookies,qqRefreshParameters,biliWebCredential,sessionCookieValues,accountIdentity,safeSessionValue} from './session-credentials.mjs';

const invalid=()=>new PlatformError('invalid-response','Incomplete platform renewal response. Existing session kept');
const publicKey=createPublicKey({key:Buffer.from('MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDLgd2OAkcGVtoE3ThUREbio0EgUc/prcajMKXvkCKFCWhJYJcLkcM2DKKcSeFpD/j6Boy538YXnR6VhcuUJOhH2x71nzPjfdTcqMz7djHum0qSZA0AyCBDABUqCrfNgCiJ00Ra7GmRj+YCK1NJEuewlb40JNrRuoEUXpabUzGB8QIDAQAB','base64'),type:'spki',format:'der'});
export function biliCorrespondPath(timestamp){
  if(!Number.isSafeInteger(timestamp) || timestamp<=0)throw invalid();
  return publicEncrypt({key:publicKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from('refresh_'+timestamp)).toString('hex');
}
export class SessionRenewalProtocols {
  constructor(providers,{now=Date.now}={}){this.providers=providers;this.now=now;}
  request(snapshot,address,{form,body,format='json'}={}){
    const source=snapshot.source;
    return this.providers.net.reply(source,address,{method:form || body?'POST':'GET',headers:{...this.providers.headers(source,snapshot.cookie),...(source==='bili'?{Origin:'https://www.bilibili.com'}:{}),...(form || body?{'Content-Type':form?'application/x-www-form-urlencoded':'application/json'}:{})},...(form?{body:new URLSearchParams(form).toString()}:body?{body:JSON.stringify(body)}:{}),signal:snapshot.signal,cache:'no-store'},snapshot.identity,format,[-101,-102,-610,86095,1000,104400,104401]);
  }
  async refresh(snapshot,force=false){
    if(snapshot.source==='qq')return this.qq(snapshot,force);
    if(snapshot.source==='bili')return this.bili(snapshot);
    return {outcome:'healthy'};
  }
  async qq(snapshot,force){
    const old=snapshot.credential;
    if(!force && old.expiresAt>this.now()+86400000)return {outcome:'healthy'};
    const parameters=qqRefreshParameters(old);if(!parameters)return {outcome:'rejected'};
    const comm={ct:old.loginType===0?11:24,cv:old.loginType===0?14090008:4747474,...(old.loginType===0?{v:14090008,chid:'10003505',tmeAppID:'qqmusic',tmeLoginMethod:3,qq:old.str_musicid}:{platform:'yqq.json'}),uin:old.str_musicid,g_tk:hash33(old.musickey,5381),g_tk_new_20200303:hash33(old.musickey,5381),authst:old.musickey,tmeLoginType:old.loginType,format:'json',inCharset:'utf-8',outCharset:'utf-8'};
    const {body}=await this.request(snapshot,'https://u.y.qq.com/cgi-bin/musicu.fcg',{body:{comm,req_0:{module:'music.login.LoginServer',method:'Login',param:parameters}}});
    const answer=body.req_0;
    if([1000,104400,104401].includes(body.code) || [1000,104400,104401].includes(answer?.code) || answer?.data?.code && answer.data.code!==0)return {outcome:'rejected'};
    if(body.code!==0 || answer?.code!==0 || !answer.data)throw invalid();
    if(!safeSessionValue(answer.data.musickey) || answer.data.musickey.length<8)throw invalid();
    for(const field of ['musicid','str_musicid'])if(answer.data[field]!==undefined){const id=answer.data[field];if(typeof id==='number' && !Number.isSafeInteger(id) || accountIdentity('qq','uin='+String(id))!==accountIdentity('qq',snapshot.cookie))throw invalid();}
    const credential=qqCredential({...old,...answer.data},old.loginType,this.now());if(!credential)throw invalid();
    const cookie=cookieHeader(qqCredentialCookies(credential));
    if(accountIdentity('qq',cookie)!==accountIdentity('qq',snapshot.cookie))throw invalid();
    return {outcome:'refreshed',credential,cookie};
  }
  async bili(snapshot){
    const old=snapshot.credential;
    if(old.pendingConfirm){await this.confirm(snapshot);return {outcome:'confirmed'};}
    const previous=sessionCookieValues(snapshot.cookie),csrf=previous.bili_jct;
    if(!/^[a-fA-F0-9]{32}$/.test(csrf || ''))return {outcome:'rejected'};
    const {body:info}=await this.request(snapshot,'https://passport.bilibili.com/x/passport-login/web/cookie/info?'+new URLSearchParams({csrf}));
    if(info.code===-101)return {outcome:'rejected'};
    if(info.code!==0 || typeof info.data?.refresh!=='boolean')throw invalid();
    if(!info.data.refresh)return {outcome:'healthy'};
    const path=biliCorrespondPath(info.data.timestamp);
    const html=await this.request(snapshot,'https://www.bilibili.com/correspond/1/'+path,{format:'text'});
    const refreshCsrf=/<div\s+id=["']1-name["'][^>]*>\s*([a-zA-Z0-9_-]{16,256})\s*<\/div>/.exec(html.body)?.[1];if(!refreshCsrf)throw invalid();
    const address='https://passport.bilibili.com/x/passport-login/web/cookie/refresh';
    const result=await this.request(snapshot,address,{form:{csrf,refresh_csrf:refreshCsrf,source:'main_web',refresh_token:old.refresh_token}}),body=result.body;
    if([-101,86095].includes(body.code))return {outcome:'rejected'};
    const values=cookieValues(result.headers,address);
    if(body.code!==0 || !values.SESSDATA || !/^[a-fA-F0-9]{32}$/.test(values.bili_jct || '') || !values.DedeUserID)throw invalid();
    const credential=biliWebCredential(body.data,values,this.now()),cookie=cookieHeader({...previous,...values});
    if(!credential || accountIdentity('bili',cookie)!==accountIdentity('bili',snapshot.cookie))throw invalid();
    // Commit this complete new snapshot before acknowledging the old refresh token.
    return {outcome:'refreshed',credential:{...credential,pendingConfirm:old.refresh_token},cookie};
  }
  async confirm(snapshot){
    const {body}=await this.request(snapshot,'https://passport.bilibili.com/x/passport-login/web/confirm/refresh',{form:{csrf:sessionCookieValues(snapshot.cookie).bili_jct,refresh_token:snapshot.credential.pendingConfirm}});
    if(body.code!==0)throw new PlatformError('unavailable','Bilibili Renewal confirmation unavailable. New session kept');
  }
}

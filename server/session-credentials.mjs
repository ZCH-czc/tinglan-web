/* Adapted from Android PlatformSessionProtocol (ArchiveTune, GPL-3.0). */
export const safeSessionValue=value=>typeof value==='string' && value.length>0 && value.length<=4096 && !/[\x00-\x20\x7f;"\\]/.test(value);
const identifier=value=>typeof value==='string' && /^[0-9]{1,24}$/.test(value) && !/^0+$/.test(value)?value:typeof value==='number' && Number.isSafeInteger(value) && value>0?String(value):'';
const ttl=(value,fallback,max)=>Number.isSafeInteger(Number(value)) && Number(value)>0?Math.min(Number(value),max):fallback;
export function sessionCookieValues(cookie='') {
  const values=Object.create(null);
  for(const part of cookie.split(';')){const at=part.indexOf('='),name=part.slice(0,at).trim(),value=part.slice(at+1).trim();if(at>0 && /^[A-Za-z0-9_]{1,64}$/.test(name) && safeSessionValue(value))values[name]=value;}
  return values;
}
export function accountIdentity(source,cookie) {
  const values=sessionCookieValues(cookie);
  return identifier(source==='bili'?values.DedeUserID:source==='qq'?(values.qqmusic_uin || values.uin || '').replace(/^o/,''):'');
}
export function qqCredential(data,loginType=2,now=Date.now()) {
  const id=identifier(data?.str_musicid || data?.musicid),key=data?.musickey;
  if(!id || !safeSessionValue(key) || key.length<8 || ![0,1,2].includes(loginType))return null;
  const result={kind:'qq',str_musicid:id,musickey:key,loginType,expiresAt:now+ttl(data.keyExpiresIn,7*86400,30*86400)*1000};
  for(const field of ['openid','refresh_token','access_token','unionid','refresh_key'])if(safeSessionValue(data[field]))result[field]=data[field];
  for(const field of ['expired_at','musickeyCreateTime','keyExpiresIn'])if(Number.isSafeInteger(Number(data[field])) && Number(data[field])>=0)result[field]=Number(data[field]);
  return result;
}
export function qqCredentialCookies(credential) {
  return {uin:credential.str_musicid,qqmusic_uin:credential.str_musicid,qm_keyst:credential.musickey,qqmusic_key:credential.musickey,login_type:String(credential.loginType)};
}
export function qqRefreshParameters(credential) {
  if(credential?.kind!=='qq' || !safeSessionValue(credential.refresh_token) && !safeSessionValue(credential.refresh_key) || credential.loginType!==0 && !safeSessionValue(credential.openid))return null;
  const result=Object.fromEntries(['openid','refresh_token','str_musicid','musickey','refresh_key'].map(key=>[key,credential[key] || '']));
  if(credential.loginType===1)result.unionid=credential.unionid || '';
  else {if(credential.loginType===0)result.unionid=credential.unionid || '';result.access_token=credential.access_token || '';result.expired_in=credential.expired_at || 0;result.musicid=credential.str_musicid;}
  return {...result,loginMode:2};
}
export function biliWebCredential(data,cookies,now=Date.now()) {
  if(!safeSessionValue(data?.refresh_token) || data?.access_token || data?.token_info || !identifier(cookies?.DedeUserID))return null;
  return {kind:'bili_web',userId:cookies.DedeUserID,refresh_token:data.refresh_token,expiresAt:now+ttl(data.expires_in,30*86400,180*86400)*1000};
}
export function renewableCredential(source,credential,cookie) {
  const id=accountIdentity(source,cookie);if(!id)return false;
  if(source==='qq')return credential?.str_musicid===id && !!qqRefreshParameters(credential);
  return source==='bili' && credential?.kind==='bili_web' && credential.userId===id && safeSessionValue(credential.refresh_token);
}

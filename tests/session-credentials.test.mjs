import test from 'node:test';import assert from 'node:assert/strict';
import {qqCredential,qqCredentialCookies,qqRefreshParameters,biliWebCredential,renewableCredential,accountIdentity} from '../server/session-credentials.mjs';
test('QQ credentials retain only renewal fields and exact identifiers, with bounded expiry',()=>{
  const value=qqCredential({str_musicid:'9007199254740993',musicid:9007199254740992,musickey:'fixture-music-key',openid:'open',refresh_token:'refresh',password:'never-retain',keyExpiresIn:3600},2,10000);
  assert.equal(value.str_musicid,'9007199254740993');assert.equal(value.expiresAt,3610000);assert.equal(value.password,undefined);assert.equal(qqRefreshParameters(value).musicid,'9007199254740993');assert.equal(qqCredentialCookies(value).qqmusic_uin,'9007199254740993');assert.equal(qqCredential({musicid:9007199254740992,musickey:'valid-key'}),null);
});
test('cookie-only and missing OAuth renewal fields never claim automatic renewal',()=>{
  const value=qqCredential({musicid:123,musickey:'fixture-key'});assert.equal(qqRefreshParameters(value),null);assert.equal(renewableCredential('qq',value,'uin=123; qm_keyst=fixture-key'),false);
  const complete=qqCredential({musicid:123,musickey:'fixture-key',openid:'open',refresh_key:'refresh'});assert.equal(renewableCredential('qq',complete,'uin=456'),false);assert.equal(renewableCredential('qq',complete,'uin=123'),true);
});
test('QQ refresh forms follow Android login types and reject header injection',()=>{
  const data={musicid:123,musickey:'fixture-key',openid:'open',refresh_key:'refresh',access_token:'access',unionid:'union',expired_at:42};
  assert.equal(qqRefreshParameters(qqCredential(data,1)).unionid,'union');assert.equal(qqRefreshParameters(qqCredential(data,1)).access_token,undefined);assert.equal(qqRefreshParameters(qqCredential(data,2)).expired_in,42);
  assert.equal(qqCredential({...data,musickey:'bad;cookie'}),null);assert.equal(qqRefreshParameters(qqCredential({...data,openid:'bad\nvalue'})),null);
});
test('web Bilibili tokens remain distinct from native app tokens and belong to the cookie account',()=>{
  const value=biliWebCredential({refresh_token:'refresh'}, {DedeUserID:'123'},10000);assert.equal(value.kind,'bili_web');assert.equal(renewableCredential('bili',value,'DedeUserID=123'),true);assert.equal(renewableCredential('bili',value,'DedeUserID=456'),false);
  assert.equal(biliWebCredential({refresh_token:'refresh',access_token:'native'}, {DedeUserID:'123'}),null);assert.equal(biliWebCredential({}, {DedeUserID:'123'}),null);assert.equal(accountIdentity('qq','uin=o00123'),'00123');
});

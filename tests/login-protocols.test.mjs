import test from 'node:test';
import assert from 'node:assert/strict';
import {createDecipheriv,createHash} from 'node:crypto';
import {LoginProtocols,cookieValues,cookieHeader,neteaseEapi,qqCallback,checkedQrPng,hash33} from '../server/login-protocols.mjs';
import {RequestGovernor} from '../server/upstream.mjs';
const png=()=>{const b=Buffer.alloc(128);b.set([137,80,78,71,13,10,26,10]);b.writeUInt32BE(13,8);b.write('IHDR',12);b.writeUInt32BE(144,16);b.writeUInt32BE(144,20);return b;};
const record=source=>({source,id:'fixture',controller:new AbortController()});
const response=(body,headers={},status=200)=>({body,headers:new Headers(headers),status});
function fixture(replies) {const calls=[];const providers={headers:()=>({Referer:'https://fixture.test/'}),net:{reply:async(...args)=>{calls.push(args);return replies(args,calls.length);}}};return {protocols:new LoginProtocols(providers),calls,providers};}
test('Bilibili web QR states map to one authorization, which requires same-domain complete session cookies',async()=>{
  let code=86101;const f=fixture(([_,url])=>url.includes('/generate')?response({code:0,data:{qrcode_key:'fixture_key',url:'https://passport.bilibili.com/qr?fixture=1'}}):response({code:0,data:{code}},{'set-cookie':'SESSDATA=fixture; Domain=.bilibili.com; HttpOnly, DedeUserID=12345; Domain=.bilibili.com, bili_jct='+ 'a'.repeat(32)+'; Domain=.bilibili.com'})),r=record('bili');
  assert.match((await f.protocols.start(r)).url,/passport.bilibili.com/);assert.equal(r.key,'fixture_key');
  assert.equal((await f.protocols.poll(r)).status,'waiting');code=86090;assert.equal((await f.protocols.poll(r)).status,'scanned');code=86038;assert.equal((await f.protocols.poll(r)).status,'expired');code=0;
  const auth=await f.protocols.poll(r);assert.equal(auth.status,'authorized');assert.match(auth.cookie,/SESSDATA=fixture/);
  f.providers.net.reply=async()=>response({code:0,data:{code:0}},{'set-cookie':'SESSDATA=fixture; Domain=evil.test'});await assert.rejects(f.protocols.poll(r),{code:'invalid-response'});
  assert.ok(f.calls.every(c=>c[3]==='login:fixture' && c[2].signal===r.controller.signal));
});
test('Bilibili current account H5 QR URL retains its challenge while polling stays on the official passport endpoint',async()=>{
  const qr='https://account.bilibili.com/h5/account-h5/auth/scan-web?navhide=1&callback=close&qrcode_key=fixture_key&from=main-web';
  const f=fixture(([_,url])=>url.includes('/generate')?response({code:0,data:{qrcode_key:'fixture_key',url:qr}}):response({code:0,data:{code:86101}})),r=record('bili');
  assert.equal((await f.protocols.start(r)).url,qr);assert.equal((await f.protocols.poll(r)).status,'waiting');
  const poll=new URL(f.calls.at(-1)[1]);assert.equal(poll.origin,'https://passport.bilibili.com');assert.equal(poll.pathname,'/x/passport-login/web/qrcode/poll');assert.equal(poll.searchParams.get('qrcode_key'),'fixture_key');
});
test('Bilibili QR validation keeps legacy official addresses and rejects foreign, mismatched and duplicate-key landing pages',async()=>{
  const modern='https://account.bilibili.com/h5/account-h5/auth/scan-web?qrcode_key=fixture_key';
  for(const host of ['passport.bilibili.com','www.bilibili.com']){
    const qr=`https://${host}/h5-app/passport/login/scan?navhide=1&key=fixture_key`;
    const f=fixture(()=>response({code:0,data:{qrcode_key:'fixture_key',url:qr}}));assert.equal((await f.protocols.start(record('bili'))).url,qr);
  }
  for(const qr of [modern.replace('account.bilibili.com','evil.test'),modern.replace('account.bilibili.com','account.bilibili.com.evil.test'),modern.replace('account.bilibili.com','unexpected.account.bilibili.com'),modern.replace('https:','http:'),modern.replace('account.bilibili.com','u:p@account.bilibili.com'),modern.replace('account.bilibili.com','account.bilibili.com:8443'),modern.replace('fixture_key','different_key'),modern+'&qrcode_key=fixture_key',modern.replace('/auth/scan-web','/auth/other'),modern+'#different',null]){
    const f=fixture(()=>response({code:0,data:{qrcode_key:'fixture_key',url:qr}}));await assert.rejects(f.protocols.start(record('bili')),{code:'invalid-response'});
  }
});
test('NetEase EAPI plaintext integrity and QR authorization use only the captured provider session',async()=>{
  const path='/api/login/qrcode/unikey',data={type:3,e_r:false};const cipher=new URLSearchParams(neteaseEapi(path,data)).get('params');
  const decipher=createDecipheriv('aes-128-ecb','e82ckenh8dichen8',null),clear=Buffer.concat([decipher.update(Buffer.from(cipher,'hex')),decipher.final()]).toString();
  const [decodedPath,json,digest]=clear.split('-36cd479b6b5-');assert.equal(decodedPath,path);assert.deepEqual(JSON.parse(json),data);assert.equal(digest,createHash('md5').update(`nobody${path}use${json}md5forencrypt`).digest('hex'));
  let code=801;const f=fixture(([_,url])=>url.endsWith('/unikey')?response({code:200,unikey:'fixture_key'},{'set-cookie':'NMTID=fixture-device; Domain=.music.163.com'}):response({code},{'set-cookie':'MUSIC_U=fixture-authorized; Domain=.music.163.com'})),r=record('netease');
  assert.equal((await f.protocols.start(r)).url,'https://music.163.com/login?codekey=fixture_key');assert.equal((await f.protocols.poll(r)).status,'waiting');code=802;assert.equal((await f.protocols.poll(r)).status,'scanned');code=803;assert.match((await f.protocols.poll(r)).cookie,/MUSIC_U=fixture-authorized/);
  assert.ok(f.calls.every(c=>c[1].startsWith('https://interfacepc.music.163.com/eapi/') && c[2].method==='POST'));assert.deepEqual(f.calls.at(-1)[5],[800,801,802,803]);
});
test('QQ PNG/session, scan statuses and fixed OAuth exchange retain only QQ Music cookies',async()=>{
  let code=66;const f=fixture(([_,url,options])=>{
    if(url.includes('/ptqrshow'))return response(png(),{'set-cookie':'qrsig=fixture-sig; Domain=.qq.com'});
    if(url.includes('/ptqrlogin'))return response(`ptuiCB('${code}','0','https://graph.qq.com/login_jump?uin=123456&ptsigx=fixture-signature','0','message','nick');`);
    if(url.includes('/check_sig'))return response(Buffer.alloc(0),{'set-cookie':'p_skey=fixture-oauth; Domain=.qq.com'},302);
    if(url.includes('/authorize'))return response(Buffer.alloc(0),{location:'https://y.qq.com/portal/wx_redirect.html?code=fixture-code&state='+new URLSearchParams(options.body).get('state')},302);
    if(url.includes('/musicu.fcg'))return response({code:0,req_0:{code:0,data:{musicid:123456,musickey:'fixture-music-key',openid:'fixture-open',refresh_key:'fixture-refresh-key'}}});throw new Error('Unexpected protocol URL');
  }),r=record('qq');assert.equal((await f.protocols.start(r)).image.length,128);
  assert.equal((await f.protocols.poll(r)).status,'waiting');code=67;assert.equal((await f.protocols.poll(r)).status,'scanned');code=65;assert.equal((await f.protocols.poll(r)).status,'expired');code=68;assert.equal((await f.protocols.poll(r)).status,'refused');code=0;
  const auth=await f.protocols.poll(r);assert.match(auth.cookie,/qm_keyst=fixture-music-key/);assert.doesNotMatch(auth.cookie,/p_skey|qrsig|fixture-oauth/);assert.equal(auth.credential.openid,'fixture-open');assert.equal(auth.credential.refresh_key,'fixture-refresh-key');assert.equal(auth.credential.loginType,2);
  const exchange=f.calls.at(-1);assert.deepEqual(JSON.parse(exchange[2].body).req_0.param,{code:'fixture-code'});assert.equal(exchange[1],'https://u.y.qq.com/cgi-bin/musicu.fcg');
  assert.equal(hash33('abc'),108966);assert.equal(hash33('abc',5381),193485963);
});
test('QQ callback parser never evaluates code, and OAuth rejects foreign redirects and mismatched state',async()=>{
  assert.deepEqual(qqCallback("ptuiCB('66','0','','0','message','O\\'Neil');").slice(0,3),['66','0','']);
  for(const text of ["ptuiCB('0','0','url');alert('x')","ptuiCB('0',evil(),'url');","ptuiCB('0','0','url' + 'evil');"])assert.throws(()=>qqCallback(text),{code:'invalid-response'});
  for(const location of ['https://evil.test/?code=fixture','https://y.qq.com/portal/wx_redirect.html?code=fixture&state=wrong']) {
    let calls=0;const f=fixture(()=> ++calls===1?response(Buffer.alloc(0),{'set-cookie':'p_skey=fixture; Domain=.qq.com'},302):response(Buffer.alloc(0),{location},302));
    await assert.rejects(f.protocols.qqAuthorize(record('qq'),'12345','fixture'),{code:'invalid-response'});assert.equal(calls,2);
  }
});
test('cookie capture filters foreign domains, invalid values and deleted entries; QR size constraints reject malformed images',()=>{
  const values=cookieValues(new Headers({'set-cookie':'valid=a%20b; Domain=.bilibili.com, evil=secret; Domain=evil.test, deleted=x; Max-Age=0, invalid=a b'}),'https://passport.bilibili.com/');
  assert.equal(cookieHeader(values),'valid=a%20b');assert.equal(Object.getPrototypeOf(values),null);
  assert.throws(()=>checkedQrPng(Buffer.from('not-png')));const tooLarge=png();tooLarge.writeUInt32BE(99999,16);assert.throws(()=>checkedQrPng(tooLarge));
});
test('QQ Music account identifiers retain exact string precision and reject unsafe numeric identifiers',async()=>{
  for(const value of [{musicid:9007199254740992},{musicid:9007199254740992,str_musicid:'9007199254740993'}]) {
    const f=fixture(([_,url,options])=>url.includes('/check_sig')?response(Buffer.alloc(0),{'set-cookie':'p_skey=fixture; Domain=.qq.com'},302):url.includes('/authorize')?response(Buffer.alloc(0),{location:'https://y.qq.com/portal/wx_redirect.html?code=fixture-code&state='+new URLSearchParams(options.body).get('state')},302):response({code:0,req_0:{code:0,data:{...value,musickey:'fixture-music-key'}}}));
    if(value.str_musicid)assert.match((await f.protocols.qqAuthorize(record('qq'),'12345','fixture')).cookie,/uin=9007199254740993/);
    else await assert.rejects(f.protocols.qqAuthorize(record('qq'),'12345','fixture'),{code:'invalid-response'});
  }
});
test('login transport shares verification cooldown, follows no redirect, caches no replies and cancels queued requests',async()=>{
  let calls=0;const governor=new RequestGovernor({gap:0,fetcher:async(_url,opts)=>{++calls;assert.equal(opts.redirect,'manual');return new Response(null,{status:302,headers:{location:'https://y.qq.com/portal/wx_redirect.html'}});}});
  const a=await governor.reply('qq','https://graph.qq.com/oauth2.0/authorize',{},'fixture','bytes');assert.equal(a.status,302);await governor.reply('qq','https://graph.qq.com/oauth2.0/authorize',{},'fixture','bytes');assert.equal(calls,2);assert.equal(governor.cache.size,0);
  const stopped=new RequestGovernor({gap:0,fetcher:async()=>{++calls;return new Response(null,{status:412});}});await assert.rejects(stopped.reply('bili','https://passport.bilibili.com/qr'),{code:'verification'});await assert.rejects(stopped.json('bili','https://api.bilibili.com/content'),{code:'cooldown'});assert.equal(calls,3);
  const abort=new AbortController();abort.abort();await assert.rejects(governor.reply('qq','https://graph.qq.com/qr',{signal:abort.signal}),{name:'AbortError'});assert.equal(calls,3);
});

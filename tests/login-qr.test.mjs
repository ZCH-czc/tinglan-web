import test from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import {loginQrRows} from '../build/dist/login-qr.mjs';
test('production login QR symbols decode independently for the three platform URLs with four-module quiet zones',()=>{
  for(const text of ['https://passport.bilibili.com/h5-app/passport/login/scan?navhide=1&key=fixture_key','https://account.bilibili.com/h5/account-h5/auth/scan-web?navhide=1&callback=close&qrcode_key=fixture_key&from=main-web','https://music.163.com/login?codekey=fixture_key','https://fixture.qq.com/login?state='+ 'x'.repeat(128)]) {
    const rows=loginQrRows(text),unit=5,width=(rows.length+8)*unit,pixels=new Uint8ClampedArray(width*width*4).fill(255);
    for(let y=0;y<rows.length;y++)for(let x=0;x<rows.length;x++)if(rows[y][x]==='1')for(let dy=0;dy<unit;dy++)for(let dx=0;dx<unit;dx++) {
      const at=(((y+4)*unit+dy)*width+(x+4)*unit+dx)*4;pixels[at]=pixels[at+1]=pixels[at+2]=0;
    }
    assert.equal(jsQR(pixels,width,width)?.data,text);assert.ok(rows.every(row=>row.length===rows.length));
  }
  assert.throws(()=>loginQrRows('x'.repeat(2049)));assert.throws(()=>loginQrRows(null));
});

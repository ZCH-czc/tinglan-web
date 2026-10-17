import QRCode from 'qrcode';
/** Symbol data only: Compose/Skia draws modules with a four-module quiet zone. */
export function loginQrRows(text) {
  if(typeof text!=='string' || text.length>2048)throw new Error('Invalid sign-in QR contents');
  const {modules}=QRCode.create(text,{errorCorrectionLevel:'M'});
  if(modules.size>177)throw new Error('Sign-in QR code is too large');
  return Array.from({length:modules.size},(_,y)=>Array.from({length:modules.size},(_,x)=>modules.get(y,x)?'1':'0').join(''));
}

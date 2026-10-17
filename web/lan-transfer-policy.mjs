/** Android LanTransferPolicy-compatible limits and raw upload protocol. */
export const LAN_LIMITS=Object.freeze({fileBytes:512*1024*1024,pendingBytes:1024*1024*1024,rows:20,lifetimeMs:600000,leaseMs:15000,uploadMs:120000});
export function privateIpv4(value) {
  if(typeof value!=='string' || !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value))return false;
  const b=value.split('.').map(Number);return b.every(v=>v<=255) && (b[0]===10 || b[0]===192&&b[1]===168 || b[0]===172&&b[1]>=16&&b[1]<=31);
}
export function audioFilename(value) {
  if(typeof value!=='string' || !value || value.length>2048)throw new Error('Choose a supported local audio file');
  const name=value.split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f<>:"|?*]/g,'_').trim().slice(0,180);
  if(!/\.(mp3|m4a|aac|flac|wav|ogg|opus|aiff?|ape|wma)$/i.test(name))throw new Error('Choose MP3、M4A、AAC、FLAC、WAV、Ogg、Opus、AIFF、APE or WMA audio');
  return name;
}
export function hasAudioHeader(name,bytes) {
  const b=new Uint8Array(bytes),text=(start,length)=>String.fromCharCode(...b.slice(start,start+length)),ext=name.split('.').at(-1).toLowerCase();
  if(b.length<12)return false;
  if(ext==='wav')return text(0,4)==='RIFF' && text(8,4)==='WAVE';
  if(ext==='flac')return text(0,4)==='fLaC';
  if(ext==='m4a')return text(4,4)==='ftyp';
  if(ext==='ogg' || ext==='opus')return text(0,4)==='OggS';
  if(ext==='aif' || ext==='aiff')return text(0,4)==='FORM' && ['AIFF','AIFC'].includes(text(8,4));
  if(ext==='ape')return text(0,4)==='MAC ';
  if(ext==='wma')return [0x30,0x26,0xb2,0x75,0x8e,0x66,0xcf,0x11].every((v,i)=>b[i]===v);
  if(ext==='aac')return b[0]===255 && (b[1]&0xf6)===0xf0;
  if(ext==='mp3')return text(0,3)==='ID3' || b[0]===255 && (b[1]&0xe0)===0xe0;
  return false;
}
export function lanTarget(value,{loopback=false}={}) {
  let url;try{url=new URL(value);}catch{throw new Error('Use the LAN QR address shown on the receiving device');}
  const token=url.searchParams.get('key') || new URLSearchParams(url.hash.slice(1)).get('key');
  if(url.protocol!=='http:' || !privateIpv4(url.hostname) && !(loopback&&url.hostname==='127.0.0.1') || !url.port || url.pathname!=='/' || url.username || url.password || !/^[a-f0-9]{64}$/.test(token || '') || [...url.searchParams.keys()].some(key=>key!=='key') || [...new URLSearchParams(url.hash.slice(1)).keys()].some(key=>key!=='key'))throw new Error('Invalid receiver address. Scan its QR code again');
  return {origin:url.origin,token};
}

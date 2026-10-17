import {LOCAL_INDEX,validateMarks} from './local-index-data.mjs';
export const encodeBytes=bytes=>{let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);};
export const decodeBytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
export function localPcm(channels,rate) {
  if(!Array.isArray(channels) || !channels.length || channels.length>8 || channels.some(a=>!(a instanceof Float32Array) || a.length!==channels[0].length) || !Number.isInteger(rate) || rate<8000 || rate>192000 || channels[0].length>rate*40 || channels[0].length<2048)throw new Error('Invalid audio format for local analysis');
  const length=Math.floor(channels[0].length*16000/rate),output=new Int16Array(length),sample=i=>{let sum=0;for(const c of channels){const n=c[i];if(!Number.isFinite(n))throw new Error('Audio contains invalid samples');sum+=n;}return sum/channels.length;};
  if(rate===16000){for(let i=0;i<length;i++)output[i]=Math.max(-32768,Math.min(32767,Math.trunc(sample(i)*32768)));}
  else {const cutoff=Math.min(7200,rate*.45)/rate;for(let i=0;i<length;i++){const position=i*rate/16000,center=Math.floor(position);let total=0,value=0;for(let k=-31;k<=31;k++){const x=center+k-position,w=(x===0?2*cutoff:Math.sin(2*Math.PI*cutoff*x)/(Math.PI*x))*(.54+.46*Math.cos(Math.PI*k/31));value+=sample(Math.max(0,Math.min(channels[0].length-1,center+k)))*w;total+=w;}output[i]=Math.max(-32768,Math.min(32767,Math.trunc(value/total*32768)));}}
  return new Uint8Array(output.buffer);
}
export function combineMarks(buffers){const size=Math.min(LOCAL_INDEX.marks*8,buffers.reduce((s,b)=>s+b.byteLength,0));if(!size)throw new Error('No valid fingerprint extracted');const result=new Uint8Array(size);let offset=0;for(const buffer of buffers){const bytes=new Uint8Array(buffer);const count=Math.min(size-offset,bytes.length);result.set(bytes.subarray(0,count),offset);offset+=count;if(offset===size)break;}return validateMarks(result.buffer);}

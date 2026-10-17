import {RECOGNITION_LIMITS as L} from './recognition-data.mjs';
/** Windowed sinc low pass conversion to the extension's exact six seconds of 8 kHz mono Float32. */
export function fingerprintPcm(samples,rate) {
  if(!(samples instanceof Float32Array) || !Number.isInteger(rate) || rate<8000 || rate>192000 || samples.length!==rate*L.seconds)throw new Error('Invalid recognition audio length or sample rate');
  let energy=0;for(const n of samples){if(!Number.isFinite(n))throw new Error('Recognition audio contains invalid samples');energy+=n*n;}
  if(energy/samples.length<.000001)throw Object.assign(new Error('Audio is too quiet. Move closer to the music and retry'),{code:'quiet'});
  const out=new Float32Array(L.sampleRate*L.seconds),cutoff=Math.min(3600,rate*.45)/rate;
  for(let i=0;i<out.length;i++){
    const position=i*rate/L.sampleRate,center=Math.floor(position);let sum=0,total=0;
    for(let tap=-31;tap<=31;tap++){const distance=center+tap-position,sinc=distance===0?2*cutoff:Math.sin(2*Math.PI*cutoff*distance)/(Math.PI*distance),weight=sinc*(.54+.46*Math.cos(Math.PI*tap/31));sum+=samples[Math.max(0,Math.min(samples.length-1,center+tap))]*weight;total+=weight;}
    out[i]=Math.max(-1,Math.min(1,sum/total));
  }
  return out;
}

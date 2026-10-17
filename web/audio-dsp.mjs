import {soundSettings,LOUDNESS_TARGETS,SPATIAL_PRESETS} from './audio-settings.mjs';

/** Browser port of Android LoudnessLeveler and StereoSpatialProcessor. No per-frame allocations. */
export class ComfortDsp {
 constructor(rate,settings){if(!Number.isFinite(rate) || rate<8000 || rate>384000)throw new Error('Invalid audio sample rate');this.rate=rate;this.rmsAttack=Math.exp(-1/(rate*.025));this.rmsRelease=Math.exp(-1/(rate*.8));this.attack=Math.exp(-1/(rate*.008));this.release=Math.exp(-1/(rate*1.8));this.lowCoefficient=Math.exp(-2*Math.PI*180/rate);this.highCoefficient=Math.exp(-2*Math.PI*2500/rate);this.ramp=1-Math.exp(-1/(rate*.12));this.delayL=new Float64Array(Math.max(1,Math.floor(rate*.00025)));this.delayR=new Float64Array(this.delayL.length);this.configure(settings);this.reset();}
 configure(settings){const s=this.settings=soundSettings(settings);this.target=10**(LOUDNESS_TARGETS[s.loudnessPreset]/20);this.ceiling=10**(-2/20);this.outputTarget=10**(s.outputGainDb/20);this.spatialTarget=s.enabled && s.spatial?1:0;this.spatialValues=SPATIAL_PRESETS[s.spatialPreset];}
 reset(){this.envelope=0;this.gain=1;this.outputGain=this.outputTarget;this.primed=false;this.blend=0;this.width=1;this.cross=0;this.bass=1;this.treble=1;this.lowL=0;this.lowR=0;this.highL=0;this.highR=0;this.delayL.fill(0);this.delayR.fill(0);this.cursor=0;}
 prime(left,right,length){let sum=0;for(let i=0;i<length;i++){const l=Number.isFinite(left?.[i])?left[i]:0,r=Number.isFinite(right?.[i])?right[i]:l;sum+=(l*l+r*r)*.5;}if(sum<=0)return;this.envelope=length?sum/length:0;const rms=Math.sqrt(this.envelope);this.gain=this.settings.loudness && rms>this.target?this.target/rms:1;this.primed=true;}
 process(left,right,outL,outR){const length=outL.length,s=this.settings;if(!this.primed && left?.length)this.prime(left,right,length);
  for(let i=0;i<length;i++){
   const rawL=Number.isFinite(left?.[i])?left[i]:0,rawR=Number.isFinite(right?.[i])?right[i]:rawL;
   if(!s.enabled){outL[i]=rawL;if(outR)outR[i]=rawR;continue;}
   let l=rawL,r=rawR;
   if(this.spatialTarget || this.blend>1e-5){
    this.blend+=(this.spatialTarget-this.blend)*this.ramp;this.width+=(this.spatialValues[0]-this.width)*this.ramp;this.cross+=(this.spatialValues[1]-this.cross)*this.ramp;this.bass+=(this.spatialValues[2]-this.bass)*this.ramp;this.treble+=(this.spatialValues[3]-this.treble)*this.ramp;
    this.lowL=this.lowCoefficient*this.lowL+(1-this.lowCoefficient)*l;this.lowR=this.lowCoefficient*this.lowR+(1-this.lowCoefficient)*r;this.highL=this.highCoefficient*this.highL+(1-this.highCoefficient)*l;this.highR=this.highCoefficient*this.highR+(1-this.highCoefficient)*r;
    const delayedL=this.delayL[this.cursor],delayedR=this.delayR[this.cursor];this.delayL[this.cursor]=this.highL;this.delayR[this.cursor]=this.highR;this.cursor=(this.cursor+1)%this.delayL.length;
    const tl=l+(this.bass-1)*this.lowL+(this.treble-1)*(l-this.highL),tr=r+(this.bass-1)*this.lowR+(this.treble-1)*(r-this.highR),mid=(tl+tr)*.5,side=(tl-tr)*.5*this.width,compensation=Math.max(1,this.width)*(1+this.cross);
    l+=this.blend*((mid+side+this.cross*delayedR)/compensation-l);r+=this.blend*((mid-side+this.cross*delayedL)/compensation-r);
   }
   const energy=(l*l+r*r)*.5,peak=Math.max(Math.abs(l),Math.abs(r)),coefficient=energy>this.envelope?this.rmsAttack:this.rmsRelease;
   this.envelope=coefficient*this.envelope+(1-coefficient)*energy;const rms=Math.sqrt(this.envelope),desired=s.loudness && rms>this.target?this.target/rms:1,peakGain=s.peakProtection && peak>this.ceiling?this.ceiling/peak:1,target=Math.min(desired,peakGain);
   this.gain=(target<this.gain?this.attack:this.release)*this.gain+(1-(target<this.gain?this.attack:this.release))*target;if(s.peakProtection)this.gain=Math.min(this.gain,peakGain);
   const outputCoefficient=this.outputTarget<this.outputGain?this.attack:this.release;this.outputGain=outputCoefficient*this.outputGain+(1-outputCoefficient)*this.outputTarget;
   const gain=Math.max(0,Math.min(1,this.gain))*this.outputGain;outL[i]=l*gain;if(outR)outR[i]=r*gain;
  }
 }
}

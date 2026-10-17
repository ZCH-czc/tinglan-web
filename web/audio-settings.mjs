export const EQ_FREQUENCIES=Object.freeze([60,230,910,3600,14000]);
export const EQ_PRESETS=Object.freeze({flat:[0,0,0,0,0],vocal:[-2,-1,3,2,0],bass:[5,3,0,-1,0],bright:[-1,0,0,3,5]});
export const LOUDNESS_TARGETS=Object.freeze({balanced:-18,comfort:-21,night:-24});
export const SPATIAL_PRESETS=Object.freeze({natural:[1.08,0,1,.98],wide:[1.35,0,.95,1],car:[1.12,.04,.9,.94],headphones:[1.12,.16,1,.97]});
export const SOUND_DEFAULTS=Object.freeze({enabled:false,loudness:true,peakProtection:true,loudnessPreset:'balanced',eqEnabled:false,eqPreset:'flat',bands:Object.freeze([0,0,0,0,0]),outputGainDb:0,spatial:false,spatialPreset:'natural'});
const bounded=(v,min,max,fallback=0)=>Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback;
export function soundSettings(value){const v=value && typeof value==='object'?value:{},preset=Object.hasOwn(EQ_PRESETS,v.eqPreset)?v.eqPreset:'flat';
 const bands=Array.isArray(v.bands)?EQ_FREQUENCIES.map((_,i)=>bounded(v.bands[i],-12,12)):[...EQ_PRESETS[preset]];
 const eqPreset=v.eqPreset==='custom' || bands.some((gain,i)=>gain!==EQ_PRESETS[preset][i])?'custom':preset;
 return {
 enabled:v.enabled===true,loudness:v.loudness!==false,peakProtection:v.peakProtection!==false,loudnessPreset:Object.hasOwn(LOUDNESS_TARGETS,v.loudnessPreset)?v.loudnessPreset:'balanced',
 eqEnabled:v.eqEnabled===true,eqPreset,bands,
 outputGainDb:bounded(v.outputGainDb,-15,0),spatial:v.spatial===true,spatialPreset:Object.hasOwn(SPATIAL_PRESETS,v.spatialPreset)?v.spatialPreset:'natural',
};}
export function soundPatch(previous,{key,value,index}={}){
 const current=soundSettings(previous),next={...current},band=typeof index==='number'?index:/^[0-4]$/.test(index)?Number(index):-1;
 if(['enabled','loudness','peakProtection','eqEnabled','spatial'].includes(key))next[key]=value===true || value==='true';
 else if(key==='eqPreset' && Object.hasOwn(EQ_PRESETS,value)){next.eqPreset=value;next.bands=[...EQ_PRESETS[value]];}
 else if(key==='band' && Number.isInteger(band) && band>=0 && band<5){next.bands=[...current.bands];next.bands[band]=bounded(Number(value),-12,12);next.eqPreset='custom';}
 else if(['loudnessPreset','spatialPreset'].includes(key))next[key]=value;
 else if(key==='outputGainDb')next.outputGainDb=bounded(Number(value),-15,0);
 else if(key==='reset')return {...soundSettings(SOUND_DEFAULTS),enabled:current.enabled};
 return soundSettings(next);
}

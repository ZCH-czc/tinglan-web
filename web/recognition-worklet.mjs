/** Finite capture only; no monitoring sound, per-frame allocations or continuous main-thread PCM messages. */
class RecognitionCapture extends AudioWorkletProcessor {
  constructor(options={}){super();this.seconds=Math.min(40,Math.max(.128,Number(options.processorOptions?.seconds)||6));this.samples=new Float32Array(Math.floor(sampleRate*this.seconds));this.offset=0;this.armed=false;this.nextProgress=0;this.port.onmessage=e=>{if(e.data==='start')this.armed=true;};}
  process(inputs,outputs){for(const output of outputs)for(const channel of output)channel.fill(0);if(!this.armed || !this.samples)return true;
    const channels=inputs[0];if(!channels?.length)return true;if(channels.length>8){this.samples=null;this.port.postMessage({error:"Tracks with more than eight channels cannot be analyzed"});return true;}const frames=Math.min(channels[0].length,this.samples.length-this.offset),count=channels.length;
    for(let i=0;i<frames;i++){let n=0;for(let c=0;c<count;c++)n+=channels[c][i];this.samples[this.offset++]=n/count;}
    if(this.offset>=this.samples.length){const samples=this.samples;this.samples=null;this.port.postMessage({samples,rate:sampleRate},[samples.buffer]);}
    else if(this.offset>=this.nextProgress){this.nextProgress=this.offset+Math.floor(sampleRate/4);this.port.postMessage({progress:this.offset/(sampleRate*this.seconds)});}
    return true;
  }
}
registerProcessor('tinglan-recognition-capture',RecognitionCapture);

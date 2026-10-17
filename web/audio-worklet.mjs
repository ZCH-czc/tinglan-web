import {ComfortDsp} from './audio-dsp.mjs';

class TinglanComfortProcessor extends AudioWorkletProcessor {
 constructor(options){super();this.dsp=new ComfortDsp(sampleRate,options.processorOptions?.settings);this.port.onmessage=({data})=>{if(data?.type==='settings')this.dsp.configure(data.value);else if(data?.type==='reset')this.dsp.reset();};}
 process(inputs,outputs){const input=inputs[0],output=outputs[0];if(output?.[0])this.dsp.process(input?.[0],input?.[1],output[0],output[1]);return true;}
}
registerProcessor('tinglan-comfort',TinglanComfortProcessor);

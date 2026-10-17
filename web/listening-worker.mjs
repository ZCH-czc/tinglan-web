import {listeningReport} from './listening-report.mjs';
self.onmessage=event=>{const {id,input}=event.data;try{self.postMessage({id,result:listeningReport(input)});}catch(error){self.postMessage({id,error:error.message || 'Unable to generate listening report'});}};

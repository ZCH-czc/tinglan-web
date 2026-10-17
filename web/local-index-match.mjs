import {LOCAL_INDEX,validateMarks,fingerprintTerms,voteBound,canChangeDecision} from './local-index-data.mjs';
import {localPcm,encodeBytes,decodeBytes} from './local-index-codec.mjs';
export async function matchLocalIndex(engine,index,input,progress=()=>{}) {
  const encoded=engine.localFingerprintExtract(encodeBytes(localPcm([input.samples],input.rate)),0),bytes=decodeBytes(encoded),terms=bytes.length?fingerprintTerms(bytes.buffer):new Map();
  if(terms.size<12)return {matched:false,origin:'local'};
  {
    const live=new Set((await index.eligible()).map(row=>row.id)),ranks=[];
    const candidates=(await index.summaries()).filter(row=>row.version===LOCAL_INDEX.version && live.has(row.id) && row.pairs instanceof Blob && row.hashes instanceof Uint32Array && row.hashes.length<=LOCAL_INDEX.marks && row.bytes===row.pairs.size && row.bytes<=LOCAL_INDEX.marks*8).map(row=>({...row,bound:voteBound(terms,row.hashes)})).sort((a,b)=>b.bound.votes-a.bound.votes || a.id.localeCompare(b.id));
    let done=0,last=0;
    for(const row of candidates) {
      if(canChangeDecision(row.bound,ranks[0]?.score))try {
        const current=await index.source(row.id);if(current?.revision!==row.revision || current.epoch!==row.epoch)continue;
        const marks=validateMarks(await row.pairs.arrayBuffer()),digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',marks))].map(n=>n.toString(16).padStart(2,'0')).join('');if(digest!==row.digest)continue;
        const numbers=engine.localFingerprintScore(encoded,encodeBytes(new Uint8Array(marks))).split(',').map(Number),score={votes:numbers[0],frames:numbers[1],hashes:numbers[2]};
        ranks.push({row,score});ranks.sort((a,b)=>b.score.votes-a.score.votes);ranks.length=Math.min(2,ranks.length);
      }catch{/* An independently corrupt or replaced entry cannot hide other tracks. */}
      done++;if(performance.now()-last>250 || done===candidates.length){last=performance.now();progress({done,total:candidates.length});}
    }
    const best=ranks[0],runner=ranks[1]?.score;if(!best || !engine.localFingerprintAccepts(best.score.votes,best.score.frames,best.score.hashes,runner?.votes ?? -1,runner?.frames || 0,runner?.hashes || 0))return {matched:false,origin:'local'};
    const song=await index.resolve(best.row.id,best.row.revision,{epoch:best.row.epoch});return song?{matched:true,origin:'local',song,id:best.row.id,revision:best.row.revision,epoch:best.row.epoch}:{matched:false,origin:'local'};
  }
}

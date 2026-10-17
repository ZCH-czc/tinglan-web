import test from 'node:test';import assert from 'node:assert/strict';
import { pruneCatalog } from '../web/catalog-retention.mjs';
test('repeated online searches release previous results while preserving pages, queue and pending writes',()=>{
  const catalog=new Map([['playing',{}],['queued',{}],['saving',{}],['dialog-song',{}],['home',{}]]);
  for(let request=0;request<1000;request++){
    const songs=Array.from({length:30},(_,i)=>({id:`request-${request}-${i}`}));for(const song of songs)catalog.set(song.id,song);
    pruneCatalog(catalog,{sections:[{songs:[{id:'home'}]},{songs}],queue:['queued'],current:'playing',target:'dialog-song',pending:['saving']});
    assert.equal(catalog.size,35);
  }
  pruneCatalog(catalog);assert.equal(catalog.size,0);
});

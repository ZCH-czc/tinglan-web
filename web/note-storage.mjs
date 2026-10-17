import {tr} from './i18n.mjs';
import {NOTE_LIMITS,normalizeNote,normalizeNotes,noteFilter} from './note-data.mjs';
import {validId} from './library-data.mjs';

export function noteIndexes(store) {
  if(!store.indexNames.contains('recent'))store.createIndex('recent',['sortTime','songId']);
  if(!store.indexNames.contains('categoryRecent'))store.createIndex('categoryRecent',['category','sortTime','songId']);
  if(!store.indexNames.contains('category'))store.createIndex('category','category');
}
const stored=value=>({...normalizeNote(value),sortTime:-value.updatedAt,revision:crypto.randomUUID()});
const conflict=()=>Object.assign(new Error(tr("This note was edited elsewhere. Reload before saving")),{code:'note-conflict'});

/** Schedule note restore in the caller's complete library transaction; newer local edits win. */
export function restoreNotes(tx,values=[]) {
  const notes=normalizeNotes(values),target=tx.objectStore('notes');let waiting=notes.length+1,total=0,added=0;
  const done=()=>{if(--waiting===0 && total+added>NOTE_LIMITS.notes)tx.abort();};
  const count=target.count();count.onsuccess=()=>{total=count.result;done();};
  for(const note of notes) {
    const request=target.get(note.songId);request.onsuccess=()=>{
      let old;try{old=request.result?normalizeNote(request.result):null;}catch{/* A validated backup can repair a corrupt note. */}
      if(!request.result)++added;
      if(!old || note.updatedAt>old.updatedAt)try{target.put(stored({...note,createdAt:old?Math.min(note.createdAt,old.createdAt):note.createdAt}),note.songId);}catch{tx.abort();return;}
      done();
    };
  }
}

/** Indexed cursors keep only the requested and last page, not every note's text, in memory. */
export class NoteStore {
  constructor(library) {this.library=library;}
  count() {return new Promise((resolve,reject)=>{const request=this.library.db.transaction('notes').objectStore('notes').count();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  async read(id) {if(!validId(id))throw new Error(tr("Invalid track note identifier"));const row=await this.library.read('notes',id);if(row && row.songId!==id)throw new Error(tr("Note and track identifiers do not match"));return row?{...normalizeNote(row),revision:typeof row.revision==='string'?row.revision:''}:null;}
  save(value,{expectedRevision='',signal}={}) {
    const note=normalizeNote(value);let failure;
    return this.library.write(['notes'],tx=>{
      const target=tx.objectStore('notes'),request=target.get(note.songId),count=target.count();let old,total;
      const accept=()=>{if(total===undefined || old===undefined)return;if((old?.revision || '')!==expectedRevision){failure=conflict();tx.abort();return;}if(!old && total>=NOTE_LIMITS.notes){failure=new Error(tr("Notes have reached 10000 entry limit"));tx.abort();return;}try{target.put(stored(note),note.songId);}catch(error){failure=error;tx.abort();}};
      request.onsuccess=()=>{old=request.result || null;accept();};count.onsuccess=()=>{total=count.result;accept();};
    },{signal}).catch(error=>{throw failure || error;});
  }
  remove(id,{expectedRevision,signal}={}) {
    if(!validId(id))return Promise.reject(new Error(tr("Invalid track note identifier")));let failure;
    return this.library.write(['notes'],tx=>{const target=tx.objectStore('notes'),request=target.get(id);request.onsuccess=()=>{if(!request.result || (request.result.revision || '')!==expectedRevision){failure=conflict();tx.abort();return;}target.delete(id);};},{signal}).catch(error=>{throw failure || error;});
  }
  page(request,{signal}={}) {
    const filter=noteFilter(request),offset=filter.page*NOTE_LIMITS.pageSize,query=filter.query.trim().normalize('NFKC').toLocaleLowerCase('en-US');
    return new Promise((resolve,reject)=>{
      if(signal?.aborted){reject(signal.reason || new DOMException('Cancelled','AbortError'));return;}
      const tx=this.library.db.transaction('notes'),target=tx.objectStore('notes'),categories=[],selected=[],last=[];let count=0,failure;
      const abort=()=>{try{tx.abort();}catch{}},finish=()=>signal?.removeEventListener('abort',abort);signal?.addEventListener('abort',abort,{once:true});
      const keys=target.index('category').openKeyCursor(null,'nextunique');keys.onsuccess=()=>{const cursor=keys.result;if(!cursor)return;categories.push(cursor.key);cursor.continue();};
      const range=filter.category?IDBKeyRange.bound([filter.category,-8640000000000000,''],[filter.category,0,'\uffff']):null;
      const index=filter.category?target.index('categoryRecent'):target.index('recent');
      const value=item=>{const row=normalizeNote(item.value);if(row.songId!==item.primaryKey)throw new Error(tr("Note and track identifiers do not match"));return row;};
      if(!query) {
        const counted=index.count(range);counted.onsuccess=()=>{
          count=counted.result;if(!count)return;
          const page=Math.min(filter.page,Math.ceil(count/NOTE_LIMITS.pageSize)-1),skip=page*NOTE_LIMITS.pageSize,cursor=index.openCursor(range);let jumped=false;
          cursor.onsuccess=()=>{const item=cursor.result;if(!item)return;try{if(skip && !jumped){jumped=true;item.advance(skip);return;}selected.push(value(item));if(selected.length<NOTE_LIMITS.pageSize)item.continue();}catch(error){failure=error;abort();}};
        };
      }else {
        const cursor=index.openCursor(range);
        cursor.onsuccess=()=>{
          const item=cursor.result;if(!item)return;
          try {
            const row=value(item),match=`${row.title}\n${row.artists}\n${row.content}`.normalize('NFKC').toLocaleLowerCase('en-US').includes(query);
            if(match){if(count%NOTE_LIMITS.pageSize===0)last.length=0;last.push(row);if(count>=offset && count<offset+NOTE_LIMITS.pageSize)selected.push(row);++count;}
            item.continue();
          }catch(error){failure=error;abort();}
        };
      }
      tx.oncomplete=()=>{finish();const pages=Math.max(1,Math.ceil(count/NOTE_LIMITS.pageSize)),page=Math.min(filter.page,pages-1);resolve({items:!query || page===filter.page?selected:last,count,page,pages,categories});};
      tx.onerror=tx.onabort=()=>{finish();reject(failure || (signal?.aborted?signal.reason || new DOMException('Cancelled','AbortError'):tx.error || new Error(tr("Note read incomplete"))));};
    });
  }
}

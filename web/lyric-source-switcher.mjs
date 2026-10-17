import {tr} from './i18n.mjs';
/** Bilibili display titles contain promotional brackets that are not recording titles. */
export function lyricSearchMetadata(track={}) {
  const original=String(track.title || '').normalize('NFKC').trim().slice(0,200);
  let title=original;
  if(track.source==='bili') {
    const quoted=[...title.matchAll(/《([^》]{1,100})》/g)];
    const withoutBrackets=title.replace(/[【\[][^】\]]*[】\]]/g,'').replace(/[（(](?:原创曲|原创歌曲|完整版|歌曲完整版)[）)]/g,'').trim();
    title=quoted.length===1?quoted[0][1]:withoutBrackets || original;
    // Preserve recording versions; a cover/live upload must not silently select the studio original.
    for(const [pattern,label] of [[/\blive\b|现场/i,'Live'],[/\binstrumental\b|伴奏/i,'伴奏'],[/\bremix\b/i,'Remix'],[/\bacoustic\b/i,'Acoustic'],[/\bcover\b|翻唱/i,'翻唱']]) {
      if(pattern.test(original) && !pattern.test(title))title+=` (${label})`;
    }
  }
  return {title:title.replace(/\s+/g,' ').trim().slice(0,200),artist:String(track.artist || '').trim().slice(0,200),durationMs:Number(track.durationMs)||0,adjusted:title!==original};
}

/** One owned source request. Old responses cannot replace a newer choice or edited lyrics. */
export class LyricsSourceSwitcher {
  constructor({current,fetch,save,changed=()=>{},begin=()=>0}) {Object.assign(this,{current,fetch,save,changed,begin});this.generation=0;this.state={};}
  open(track){
    this.cancel();if(!track){this.state={};this.changed();return;}
    this.state={id:track.id,...lyricSearchMetadata(track),provider:track.lyricsSource==='kugou'?'kugou':'platform',loading:false,error:'',notice:''};this.changed();
  }
  cancel(){++this.generation;this.controller?.abort();this.controller=null;if(this.state?.loading)this.state={...this.state,loading:false};}
  async select(provider,query={}) {
    if(!['platform','kugou'].includes(provider))return false;
    const track=this.current();if(!track || this.state.id!==track.id)return false;
    this.cancel();const generation=this.generation,controller=new AbortController();this.controller=controller;
    const title=String(query.title ?? this.state.title).trim().slice(0,200),artist=String(query.artist ?? this.state.artist).trim().slice(0,200);
    this.state={...this.state,title,artist,provider,loading:true,error:'',notice:''};this.changed();
    const owned=()=>generation===this.generation && !controller.signal.aborted && this.current()?.id===track.id;
    try {
      if(provider==='kugou' && (!title || !artist))throw new Error(tr("Enter a title and artist before matching Kugou lyrics"));
      if(provider==='platform' && track.source==='local')throw new Error(tr("This local track has no platform lyrics. Match Kugou lyrics or edit local lyrics"));
      const revision=this.begin(track.id);
      const result=await this.fetch(track.id,controller.signal,provider,{...track,title,artist});
      if(!owned())return false;
      if(!result?.text)throw new Error(provider==='kugou'?tr("No Kugou lyrics matched the title, artist, and duration. Existing lyrics are kept. Edit the matching details and retry"):tr("The platform has no lyrics or subtitles. Existing lyrics are kept"));
      if(!await this.save(track.id,result.text,result.source,revision,owned)) {
        if(owned())throw new Error(tr("Lyrics changed in another action. Select the source again"));return false;
      }
      if(!owned())return false;
      this.state={...this.state,loading:false,error:'',notice:provider==='kugou'?tr("Kugou lyrics applied"):tr("Platform lyrics applied / Subtitles")};this.changed();return true;
    }catch(error){
      if(!owned())return false;
      this.state={...this.state,loading:false,error:error.message || tr("Lyrics switch incomplete. Retry"),notice:''};this.changed();return false;
    }finally{if(generation===this.generation)this.controller=null;}
  }
}

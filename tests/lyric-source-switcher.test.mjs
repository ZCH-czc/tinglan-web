import test from 'node:test';
import assert from 'node:assert/strict';
import {LyricsSourceSwitcher,lyricSearchMetadata} from '../web/lyric-source-switcher.mjs';
const row={id:'bili-BV1xx411c7mD',source:'bili',title:'【2026巡演主题曲】羁绊环游线【冰火歌会】',artist:'泠鸢yousa',durationMs:194000};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};

test('Bilibili promotional brackets do not become the exact lyric recording title',()=>{
  assert.deepEqual(lyricSearchMetadata(row),{title:'羁绊环游线',artist:'泠鸢yousa',durationMs:194000,adjusted:true});
  assert.equal(row.title,'【2026巡演主题曲】羁绊环游线【冰火歌会】');
  assert.equal(lyricSearchMetadata({...row,title:'用家乡话写歌《回老家宜宾去》，那里有旧事的港湾'}).title,'回老家宜宾去');
  assert.equal(lyricSearchMetadata({...row,title:'【海风】'}).title,'【海风】');
  assert.equal(lyricSearchMetadata({...row,source:'qq'}).title,row.title);
});
test('automatic title cleanup preserves explicit live, cover and instrumental versions',()=>{
  for(const [title,marker] of [['【现场Live】海风','Live'],['【词作者翻唱】中古店爱情【原唱 hanser】','翻唱'],['【伴奏】海风','伴奏'],['【Remix】海风','Remix']])assert.match(lyricSearchMetadata({...row,title}).title,new RegExp(marker));
});
test('source selection uses cleaned query and updates the stored source only after owned save',async()=>{
  const calls=[],saved=[];const selector=new LyricsSourceSwitcher({current:()=>row,begin:()=>7,fetch:async(...args)=>{calls.push(args);return {text:'[00:01]synthetic line',source:'kugou'}},save:async(...args)=>{saved.push(args);return true}});
  selector.open(row);assert.equal(await selector.select('kugou'),true);assert.equal(calls[0][3].title,'羁绊环游线');assert.equal(calls[0][3].artist,row.artist);
  assert.equal(saved[0][0],row.id);assert.equal(saved[0][2],'kugou');assert.equal(saved[0][3],7);assert.equal(selector.state.notice,'Kugou lyrics applied');assert.equal(selector.state.loading,false);
});
test('no match and transport errors keep previous lyrics and expose actionable state',async()=>{
  let saved=0;const selector=new LyricsSourceSwitcher({current:()=>row,fetch:async()=>({text:'',source:'kugou'}),save:async()=>++saved});
  selector.open(row);assert.equal(await selector.select('kugou'),false);assert.match(selector.state.error,/Existing lyrics are kept/i);assert.equal(saved,0);
  selector.fetch=async()=>{throw new Error('酷狗音乐连接暂时不可用')};assert.equal(await selector.select('kugou'),false);assert.match(selector.state.error,/酷狗音乐连接暂时不可用/);assert.equal(selector.state.loading,false);
});
test('manual query correction is separate from song metadata and bounded',async()=>{
  let query;const selector=new LyricsSourceSwitcher({current:()=>row,fetch:async(_,__,___,value)=>{query=value;return {text:'[00:01]line',source:'kugou'}},save:async()=>true});
  selector.open(row);assert.equal(await selector.select('kugou',{title:' 手动曲名 ',artist:' 手动歌手 '}),true);assert.equal(query.title,'手动曲名');assert.equal(query.artist,'手动歌手');assert.equal(row.artist,'泠鸢yousa');
  assert.equal(await selector.select('kugou',{title:' ',artist:'歌手'}),false);assert.match(selector.state.error,/Enter/i);
});
test('rapid source replacement, close and track change reject old lyric replies',async()=>{
  let current=row;const old=deferred(),saved=[];const selector=new LyricsSourceSwitcher({current:()=>current,fetch:async(_,__,provider)=>provider==='kugou'?old.promise:{text:'[00:01]platform',source:'bili'},save:async(_,text)=>{saved.push(text);return true}});
  selector.open(row);const pending=selector.select('kugou');assert.equal(selector.state.loading,true);assert.equal(await selector.select('platform'),true);old.resolve({text:'[00:01]old',source:'kugou'});assert.equal(await pending,false);assert.deepEqual(saved,['[00:01]platform']);
  const late=deferred();selector.fetch=()=>late.promise;const closing=selector.select('kugou');selector.cancel();late.resolve({text:'[00:01]closed',source:'kugou'});assert.equal(await closing,false);assert.deepEqual(saved,['[00:01]platform']);
  const changed=deferred();selector.fetch=()=>changed.promise;const moving=selector.select('kugou');current={...row,id:'another'};changed.resolve({text:'[00:01]outgoing',source:'kugou'});assert.equal(await moving,false);assert.deepEqual(saved,['[00:01]platform']);
});
test('a local edit during a source request cannot be overwritten',async()=>{
  let revision=1;const pending=deferred();const selector=new LyricsSourceSwitcher({current:()=>row,begin:()=>revision,fetch:()=>pending.promise,save:async(_,__,___,expected,owned)=>owned() && revision===expected});
  selector.open(row);const request=selector.select('kugou');revision=2;pending.resolve({text:'[00:01]late',source:'kugou'});assert.equal(await request,false);assert.match(selector.state.error,/changed in another action/i);
});

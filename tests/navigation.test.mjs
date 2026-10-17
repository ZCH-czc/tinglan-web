import test from 'node:test';import assert from 'node:assert/strict';
import { RouteHistory } from '../web/navigation.mjs';
function host(){const entries=[];let index=0,listener;const h={location:{hash:'#home'},addEventListener:(_,value)=>listener=value};h.history={replaceState:(state,_,url)=>{entries[index]=state;h.location.hash=url;},pushState:(state,_,url)=>{entries.splice(++index);entries[index]=state;h.location.hash=url;},back:()=>{if(index>0){--index;queueMicrotask(()=>{h.location.hash='#'+entries[index].tinglanRoute.page;listener({state:entries[index]});});}}};return h;}

test('account hub, individual platforms and originating settings have independent back routes',async()=>{
  let shown;const nav=new RouteHistory(host(),{page:'settings'},r=>shown=r);
  nav.update({page:'accounts',accountSource:''});nav.update({accountSource:'qq'});assert.equal(shown.accountSource,'qq');
  nav.back();await Promise.resolve();assert.equal(shown.page,'accounts');assert.equal(shown.accountSource,'');
  nav.update({accountSource:'bili'});nav.back();await Promise.resolve();assert.equal(shown.accountSource,'');
  nav.back();await Promise.resolve();assert.equal(shown.page,'settings');
});
test('account entry preserves the player origin and rejects unsupported platform identifiers',async()=>{
  let shown;const nav=new RouteHistory(host(),{page:'library',tab:'favorites',player:true,videoOpen:true},r=>shown=r);
  nav.update({page:'accounts',accountSource:'bili',player:false,videoOpen:false});nav.back();await Promise.resolve();
  assert.equal(shown.player,true);assert.equal(shown.videoOpen,true);assert.equal(shown.tab,'favorites');
  nav.update({page:'accounts',accountSource:'../../qq'});assert.equal(shown.accountSource,'');
});
test('WebDAV is a real history page and opening its resumed player returns to that page before settings',async()=>{
  let shown;const nav=new RouteHistory(host(),{page:'settings'},r=>shown=r);nav.update({page:'webdav'});assert.equal(shown.page,'webdav');nav.update({player:true});nav.close('player');await Promise.resolve();assert.equal(shown.page,'webdav');assert.equal(shown.player,false);nav.back();await Promise.resolve();assert.equal(shown.page,'settings');
});
test('nested comment back restores original sorting, pagination and its originating video player',async()=>{
  let shown;const h=host(),nav=new RouteHistory(h,{page:'library',player:true,videoOpen:true},r=>shown=r);
  nav.update({page:'comments',commentId:'bili-one',commentOrder:'new',commentCursor:'{"page":2}',player:false,videoOpen:false});nav.update({commentRoot:'root',commentCursor:''});nav.update({commentCursor:'{"page":2}'});
  nav.back();await Promise.resolve();assert.equal(shown.commentRoot,'root');assert.equal(shown.commentCursor,'');nav.back();await Promise.resolve();assert.equal(shown.commentRoot,'');assert.equal(shown.commentOrder,'new');assert.equal(shown.commentCursor,'{"page":2}');nav.back();await Promise.resolve();assert.equal(shown.page,'library');assert.equal(shown.player,true);assert.equal(shown.videoOpen,true);
});
test('collection navigation retains the platform and page when a song opens the player',async()=>{
  let shown;const nav=new RouteHistory(host(),{page:'library',tab:'playlists'},r=>shown=r);nav.update({page:'collection',collectionSource:'bili',collectionId:'season_123',collectionPage:2});nav.update({player:true});nav.close('player');await Promise.resolve();assert.equal(shown.collectionSource,'bili');assert.equal(shown.collectionId,'season_123');assert.equal(shown.collectionPage,2);
});
test('closing queue and player restores the original page without reopening overlays on back',async()=>{
  let shown;const h=host(),nav=new RouteHistory(h,{page:'library',tab:'favorites'},r=>shown=r);
  nav.update({player:true});nav.update({queueOpen:true});nav.close('queueOpen');await Promise.resolve();assert.equal(shown.player,true);assert.equal(shown.queueOpen,false);
  nav.close('player');await Promise.resolve();assert.equal(shown.page,'library');assert.equal(shown.tab,'favorites');assert.equal(shown.player,false);
});
test('rapid close and open actions settle on the last intent without multiple back operations',async()=>{
  let shown;const h=host(),nav=new RouteHistory(h,{page:'home'},r=>shown=r);
  nav.update({player:true});nav.close('player');nav.close('player');nav.update({player:true});await Promise.resolve();assert.equal(shown.player,true);assert.equal(shown.page,'home');
  nav.close('player');await Promise.resolve();assert.equal(shown.player,false);assert.equal(nav.depth,0);
});
test('page and playlist back navigation retain tabs and leave the playback route separate',async()=>{
  let shown;const h=host(),nav=new RouteHistory(h,{page:'home'},r=>shown=r);
  nav.update({page:'library',tab:'playlists'});nav.update({playlistId:'p'});nav.close('playlistId');await Promise.resolve();assert.equal(shown.playlistId,'');assert.equal(shown.tab,'playlists');
  h.history.back();await Promise.resolve();assert.equal(shown.page,'home');
});
test('video back returns to the audio player, then to its original page',async()=>{
  let shown;const h=host(),nav=new RouteHistory(h,{page:'library',tab:'favorites'},r=>shown=r);
  nav.update({player:true});nav.update({videoOpen:true});nav.close('videoOpen');await Promise.resolve();assert.equal(shown.player,true);assert.equal(shown.videoOpen,false);
  nav.close('player');await Promise.resolve();assert.equal(shown.page,'library');assert.equal(shown.player,false);nav.update({videoOpen:true});assert.equal(nav.route.videoOpen,false);
});
test('author page back restores the originating player and library tab',async()=>{
  let shown;const h=host(),nav=new RouteHistory(h,{page:'library',tab:'favorites'},r=>shown=r);nav.update({player:true});nav.update({page:'creator',creatorId:'123',creatorSource:'bili',player:false});
  nav.back();await Promise.resolve();assert.equal(shown.page,'library');assert.equal(shown.tab,'favorites');assert.equal(shown.player,true);
});
test('following dynamics, detail, replies and author tabs restore their complete origin routes',async()=>{
  let shown;const nav=new RouteHistory(host(),{page:'following',followingTab:'creators'},r=>shown=r);
  nav.update({page:'creator',creatorSource:'bili',creatorId:'123',creatorTab:'dynamics'});nav.update({page:'dynamic',dynamicId:'1234567890123456789'});nav.update({page:'comments',commentId:'bili-dynamic-1234567890123456789'});nav.update({commentRoot:'42'});
  nav.back();await Promise.resolve();assert.equal(shown.commentRoot,'');nav.back();await Promise.resolve();assert.equal(shown.dynamicId,'1234567890123456789');assert.equal(shown.page,'dynamic');nav.back();await Promise.resolve();assert.equal(shown.creatorTab,'dynamics');assert.equal(shown.creatorId,'123');nav.back();await Promise.resolve();assert.equal(shown.followingTab,'creators');
});
test('dynamic routes retain exact string IDs and reject numeric or path-like identifiers',()=>{
  const nav=new RouteHistory(host(),{page:'home'},()=>{});
  nav.update({page:'dynamic',dynamicId:'1234567890123456789'});assert.equal(nav.route.dynamicId,'1234567890123456789');
  for(const id of [1234567890123456789,'0','../../1','1'.repeat(25)]){nav.update({dynamicId:id});assert.equal(nav.route.dynamicId,'');}
});
test('live routes retain the exact room number and return to the creator tab or dynamics origin',async()=>{
  let shown;const nav=new RouteHistory(host(),{page:'creator',creatorSource:'bili',creatorId:'123',creatorTab:'dynamics'},r=>shown=r);
  nav.update({page:'live',liveRoomId:'123456789012345678'});assert.equal(shown.liveRoomId,'123456789012345678');nav.back();await Promise.resolve();assert.equal(shown.page,'creator');assert.equal(shown.creatorTab,'dynamics');
  for(const id of [123456789012345678,'0','../../1','1'.repeat(19)]){nav.update({page:'live',liveRoomId:id});assert.equal(nav.route.liveRoomId,'');}
});

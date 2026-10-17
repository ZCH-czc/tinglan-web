import {tr,setLanguage,currentLanguage,languageMessages} from './i18n.mjs';
import {STATIC_HOSTING} from './deployment.mjs';
import {ImageGallery,galleryImage} from './image-gallery.mjs';
import {searchTerm,rememberSearch,forgetSearch} from './search-history.mjs';
import {libraryView,libraryOrder,playlistDetails,PlaylistEditor,SONG_SORTS} from './library-catalog.mjs';
import { LibraryStore,fileIdentity,trackFromFile,resizeArtwork } from './storage.mjs';
import { BrowserPlayback } from './playback.mjs';
import { WorkerClient } from './worker-client.mjs';
import { PlatformClient } from './platform-client.mjs';
import { DEFAULTS,LIMITS,normalizeTrack,normalizePreferences } from './library-data.mjs';
import { SnapshotBridge } from './snapshot-bridge.mjs';
import { RouteHistory } from './navigation.mjs';
import { ApplicationUpdates } from './application-updates.mjs';
import { pruneCatalog } from './catalog-retention.mjs';
import { createVideoHost } from './video-host.mjs';
import { VideoPlayback } from './video-playback.mjs';
import { DanmakuSession } from './danmaku-session.mjs';
import { CreatorPages } from './creator-pages.mjs';
import {ContentPages,collectPlaylist} from './content-pages.mjs';
import {parseCollectionLink} from './collection-links.mjs';
import {parseBilibiliId} from './bilibili-id.mjs';
import {planBilibiliSelection} from './bilibili-selection.mjs';
import {QueueMetadataSaver} from './queue-metadata.mjs';
import {ActivityFeed} from './activity-feed.mjs';
import {LivePlayback,liveRoomFromLink} from './live-playback.mjs';
import {createLiveHost} from './live-host.mjs';
import {AccountSession} from './account-session.mjs';
import {AccountStatusReader} from './account-status.mjs';
import {VideoActions} from './bilibili-actions.mjs';
import {WebDavClient} from './webdav-handoff.mjs';
import {buildHandoff} from './playback-handoff.mjs';
import {editQueueEntry,editVisibleQueueEntry,seekCurrentTrack} from './queue-entry-actions.mjs';
import {LanTransferClient} from './lan-transfer-client.mjs';
import {importLanAudio} from './lan-audio-import.mjs';
import {LivePresencePages,presenceRoute} from './live-presence.mjs';
import {NoteStore} from './note-storage.mjs';
import {NotePages,NoteEditor,NoteChanges} from './note-pages.mjs';
import {notePreview} from './note-data.mjs';
import {ListeningRecorder} from './listening-recorder.mjs';
import {ListeningStore} from './listening-storage.mjs';
import {ListeningPages} from './listening-pages.mjs';
import {RadioLibrary} from './radio-library.mjs';
import {RadioPlayback} from './radio-playback.mjs';
import {RadioPages} from './radio-pages.mjs';
import {DialogFeedback} from './dialog-feedback.mjs';
import {ClipboardWriter} from './clipboard.mjs';
import {pictureRequest,resizeContentPicture} from './content-picture.mjs';
import {WebIntegration} from './web-integration.mjs';
import {MediaCache} from './media-cache.mjs';
import {CACHE_BUDGETS,CACHE_LIMITS,cacheKind,cacheBudget,cachePatch} from './cache-policy.mjs';
import {ModalSemantics} from './modal-semantics.mjs';
import {BrowserSound} from './audio-engine.mjs';
import {soundPatch} from './audio-settings.mjs';
import {BrowserRecognitionCapture,BrowserFingerprint} from './recognition-capture.mjs';
import {RecognitionHistory} from './recognition-data.mjs';
import {MusicRecognition} from './music-recognition.mjs';
import {LocalIndexStore} from './local-index-storage.mjs';
import {LocalIndexMatcher} from './local-index-client.mjs';
import {LocalIndexManager} from './local-index-manager.mjs';
import {LocalIndexDecoder} from './local-index-decoder.mjs';
import {LyricsSourceSwitcher} from './lyric-source-switcher.mjs';

const store=new LibraryStore();const records=new Map();const remote=new Map();
const modalSemantics=new ModalSemantics();
const noteStore=new NoteStore(store);
const listeningStore=new ListeningStore(store);
const statisticsWorker=new WorkerClient(new URL('./listening-worker.mjs',import.meta.url),{timeout:60000,idleMs:30000});
let listening,statisticsPages,statisticsChannel,statsPeriod='month',statsOffset=0,statsWarning='';
let radio,radioPages,radioRevision=0,radioLibraryRevision=0,radioScope='domestic',radioQuery='',radioTimer,radioAdding=false,radioAddError='',radioStorageError='',radioAddVersion=0;
const radios=new RadioLibrary(store,()=>{++radioLibraryRevision;if(page==='radio' && ['favorites','recent'].includes(radioScope))selectRadio();emit();});
let notePages,noteEditor,notesQuery='',notesCategory='',notesPage=0,notesRevision=0,noteCount=0,noteCountRead=0,notesTimer,notesDebouncing=false,noteUpdates;
const metadata=new WorkerClient(new URL('./metadata-worker.mjs',import.meta.url),{timeout:20_000,idleMs:30_000});
const backups=new WorkerClient(new URL('./backup-worker.mjs',import.meta.url),{timeout:300_000,idleMs:30_000});
const platform=new PlatformClient(store);
const darkQuery=matchMedia('(prefers-color-scheme: dark)');const reducedQuery=matchMedia('(prefers-reduced-motion: reduce)');
let accountSession,accountSource='',accountError='',accountChecking='',accountChanging=false,accountLoad;
const accountReader=new AccountStatusReader(platform,{changed:emit});
let sound;
let recognition;
let localIndexManager,localMatcher,indexLibraryRevision=-1;
let ui,engine,playback,navigation,preferences={...DEFAULTS},ready=false;
let video,videoHost,videoOpen=false,coverOrigin=null,danmakuSession,danmakuItems=[];
let live,liveHost,liveRoomId='',hlsModule,lastLiveMetadata='';
let presencePages,presenceRevision=0;
let creatorPages,creatorState=null,creatorRevision=0,creatorId='',creatorSource='',creatorPage=1;
let creatorTab='works',dynamicId='',followingTab='dynamics',feedPages,feedState=null,feedRevision=0,dynamicPages,dynamicState=null,dynamicRevision=0,followingPages,followingState=null,followingRevision=0;
let commentPages,commentState=null,commentRevision=0,commentId='',commentRoot='',commentOrder='hot',commentCursor='';
let collectionPages,collectionState=null,collectionRevision=0,collectionId='',collectionSource='',collectionPage=1;
let searchKind='songs',importAbort=null,importReservation=null;
let biliPages,biliState=null,biliRevision=0;
let videoActions;
let webdav,lan,deviceId='',mediaEpoch=0;
let mediaCache,cacheFilter='all',cachePage=0,cacheTasksRevision=0;
const mediaActions=new Set(['radio-play','radio-queue-play','radio-toggle','radio-next','radio-previous','radio-close','radio-qq-play','play','play-group','toggle','next','previous','retry-play','seek','seek-track','lyric-seek','queue-play','queue-remove','queue-dismiss','queue-undo','bili-context-play','live-open','live-toggle','backup-restore','remove','apply-update']);
const contentImages=new Map();
const gallery=new ImageGallery({known:key=>contentImages.has(key),load:(key,signal)=>galleryImage(contentImages.get(key),signal),deliver:(key,data)=>ui?.deliverArtwork(key,data),changed:emit});
let page='home',tab='overview',query='',source=STATIC_HOSTING?'local':'all',playlistId='',player=false,queueOpen=false,dialog='',target='',dialogText='',toast='',error='';
let menuContext='',targetQueueKey='',pendingPlaylistTracks=[],playlistCreateId='';
let libraryGroup='',libraryQuery='',libraryPage=0,libraryQueryTimer;
const playlistMetadata=new Map();
const playlistEditor=new PlaylistEditor({read:id=>store.read('playlists',id),write:p=>store.putPlaylist(p),remove:id=>store.removePlaylist(id),accepted:(id,p)=>{if(p){playlistMetadata.set(id,p);engine.upsertPlaylist(p.id,p.name,p.trackIds.join('\n'),p.createdAt);}else{playlistMetadata.delete(id);engine.removePlaylist(id);}++playlistRevision;invalidateCover('playlist:'+id);emit();}});
function playlistsWithDetails(){return decode(engine.playlistsJson()).map(p=>({...p,...playlistDetails(playlistMetadata.get(p.id)),coverId:p.trackIds.find(id=>track(id)?.hasArtwork || track(id)?.artworkUrl) || p.trackIds[0] || ''}));}
function libraryStamp(){return JSON.stringify([tab,playlistId,libraryGroup,libraryQuery,preferences.librarySource,preferences.libraryTag]);}
function libraryData(){return cachedData('library-view',JSON.stringify([libraryRevision,playlistRevision,tab,playlistId,libraryGroup,libraryQuery,libraryPage,preferences.sort,preferences.sortDescending,preferences.libraryView,preferences.librarySource,preferences.libraryTag,preferences.libraryOrder,preferences.recentTrackIds]),()=>libraryView(records,playlistsWithDetails(),preferences,{tab,playlistId,group:libraryGroup,query:libraryQuery,page:libraryPage}));}
function libraryPresentation(){const data=libraryData();return cachedData('library-presentation',JSON.stringify([libraryStamp(),libraryRevision,playlistRevision,libraryPage,preferences.sort,preferences.sortDescending,preferences.libraryView,preferences.libraryOrder,preferences.recentTrackIds]),()=>({...data,stamp:libraryStamp(),selected:undefined,songs:undefined,allIds:undefined,listed:undefined,playlistIds:data.listed.map(p=>p.id),groups:data.groups.map(g=>({...g,cover:track(g.coverId)?enrich(track(g.coverId)):null})),recent:data.recent.map(enrich)}));}
const dialogFeedback=new DialogFeedback();
const clipboardWriter=new ClipboardWriter();
let libraryRevision=0,playlistRevision=0,queueRevision=0,sectionRevision=0,queueStart=0;
let queueFocus=0,queueUndo='',queueUndoTimer;
const dataCache=new Map();const empty=[];const bridge=new SnapshotBridge(raw=>ui.updateUi(raw));
function cachedData(name,key,create){const old=dataCache.get(name);if(old?.key===key){dataCache.delete(name);dataCache.set(name,old);return old.value;}const value=create();dataCache.set(name,{key,value});while(dataCache.size>20)dataCache.delete(dataCache.keys().next().value);return value;}
let busy=false,progress=0,message='',pendingBackup=null,backupText='',storage='';
const webIntegration=new WebIntegration({changed:()=>emit()});
let updatePending=false,updateAvailable=false,updatePrompt=false,updateApplying=false,updates,searchTimer,toastTimer,prefsTimer,clockTimer,backupRevision=0,lastClockSave=0;
let homeSections=[],searchSections=[],searchRevision=0,homeRevision=0,lastLyricsId='',lyricsController;
const lyricSources=new LyricsSourceSwitcher({current:()=>track(engine?.currentId()),fetch:(...args)=>platform.lyrics(...args),
  save:(id,text,sourceName,revision,owned)=>saveLyrics(id,text,false,sourceName,revision,owned),changed:emit,
  begin:id=>{lyricsController?.abort();lastLyricsId='';const revision=(lyricsRevisions.get(id)||0)+1;lyricsRevisions.set(id,revision);return revision;}});
const collapsed=new Set();const coversPending=new Set();const coverFailures=new Map();const coversUrls=new Map();
const favoriteRevisions=new Map();const lyricsRevisions=new Map();const savingTracks=new Map();const sources=STATIC_HOSTING?[]:['qq','bili','netease'];
const queueMetadata=new QueueMetadataSaver(ensureSaved,failures=>{if(failures.length)toastMessage(tr("Some queue information was not saved"));persist();});
const names={qq:tr("QQ Music"),bili:'Bilibili',netease:tr("NetEase Music")};
const decode=value=>{try{return JSON.parse(value)}catch{return null}};
const track=id=>records.get(id) || remote.get(id);
function trimRemote(){pruneCatalog(remote,{sections:[...homeSections,...searchSections,{songs:creatorPages?.retainedSongs() || []},{songs:collectionPages?.retainedSongs() || []},{songs:feedPages?.retainedSongs() || []},{songs:dynamicPages?.retainedSongs() || []},{songs:[...(biliState?.parts || []).map(row=>row.song),...(biliState?.collection?.songs || [])]}],queue:engine?[...decode(engine.queueIdsJson()),...decode(engine.undoQueueIdsJson())]:[],current:engine?.currentId(),target:dialog?target:commentId,pending:[...savingTracks.keys()]});engine?.releaseUnretained([...records.keys(),...savingTracks.keys(),...(importReservation?.ids || [])].join('\n'));}
function registerImages(value,depth=0) {
  if(!value || depth>6)return;
  if(Array.isArray(value)){for(const item of value)registerImages(item,depth+1);return;}
  if(typeof value!=='object')return;
  if(/^image-(qq|bili|netease)-[a-f0-9]{40}$/.test(value.key || '') && typeof value.path==='string' && value.path.startsWith('/api/public-image?')){contentImages.delete(value.key);contentImages.set(value.key,value.path);while(contentImages.size>4096)contentImages.delete(contentImages.keys().next().value);return;}
  for(const key of ['image','avatar','pictures','emotes','previews','parent','items','creators','playlist','activity','original'])if(value[key])registerImages(value[key],depth+1);
}
const visualComment=row=>({...row,atText:row.at>0 && row.at<8640000000000?new Date(row.at*1000).toLocaleString(currentLanguage(),{dateStyle:'short',timeStyle:'short'}):'',avatarKey:row.avatar?.key || '',avatar:undefined,emotes:row.emotes?.map(item=>({token:item.token,key:item.image.key})),pictures:row.pictures?.map(item=>item.key),previews:row.previews?.map(visualComment)});
const visualActivity=row=>({...row,avatar:undefined,avatarKey:row.avatar?.key || '',atText:row.atLabel || (row.at>0 && row.at<8640000000000?new Date(row.at*1000).toLocaleString(currentLanguage(),{dateStyle:'short',timeStyle:'short'}):''),emotes:row.emotes?.map(item=>({token:item.token,key:item.image.key})),pictures:row.pictures?.map(item=>item.key),song:row.song?enrich(row.song):null,original:row.original?visualActivity(row.original):null});
const viewKey=()=>page==='accounts'?`${page}|${accountSource}`:page==='cache'?`${page}|${cacheFilter}|${cachePage}`:page==='radio'?`${page}|${radioScope}|${radioQuery.trim().toLowerCase()}`:page==='statistics'?`${page}|${statsPeriod}|${statsOffset}`:page==='creator'?`${page}|${creatorSource}|${creatorId}|${creatorPage}|${creatorTab}`:page==='comments'?`${page}|${commentId}|${commentRoot}|${commentOrder}|${commentCursor}`:page==='collection'?`${page}|${collectionSource}|${collectionId}|${collectionPage}`:page==='dynamic'?`${page}|${dynamicId}`:page==='following'?`${page}|${followingTab}`:page==='live'?`${page}|${liveRoomId}`:page==='notes'?`${page}|${notesCategory}|${notesPage}`:page==='library'?`${page}|${playlistId}|${libraryGroup}`:page==='search'?`${page}|${searchKind}`:page;
const enrich=row=>{const value=track(row.id) || row;return {id:row.id,title:value.title,artist:value.artist,album:value.album || '',durationMs:value.durationMs || 0,favorite:!!value.favorite,hasArtwork:!!(value.hasArtwork || value.artworkUrl),source:value.source || 'local',cached:!!value.cached,cacheMode:cacheKind(value),fileBytes:value.size || 0,lyricsSource:value.lyricsSource || '',creatorId:value.creatorId || '',queueKey:row.queueKey,queueIndex:row.queueIndex}};
function toastMessage(text) {toast=text;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast='';emit()},3800);emit();}
function visibleSongs() {
  if(page==='library')return libraryData().songs;
  let songs=cachedData('sorted',`${libraryRevision}|${preferences.sort}`,()=>[...records.values()].sort((a,b)=>preferences.sort==='title'?a.title.localeCompare(b.title,'en-US'):(b.addedAt || 0)-(a.addedAt || 0)));
  if(page==='search')songs=songs.filter(s=>`${s.title}\n${s.artist}\n${s.album}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  if(page==='library') {
    if(playlistId) {const p=decode(engine.playlistJson(playlistId));return (p?.trackIds || []).map(track).filter(Boolean);}
    if(tab==='favorites')songs=songs.filter(s=>s.favorite);
    if(tab==='cached')songs=songs.filter(s=>s.cached);
  }
  return page==='home'?songs.slice(0,5):page==='settings'?empty:songs;
}
function selectedSections() {
  const sections=page==='search'?searchSections:homeSections;
  const ordered=[...sections].sort((a,b)=>Number(b.id===preferences.searchPreference)-Number(a.id===preferences.searchPreference));
  return ordered.filter(s=>page!=='search' || source==='all' || source===s.id).map(s=>({...s,collapsed:page==='search' && collapsed.has(s.id),songs:collapsed.has(s.id) && page==='search'?[]:s.songs.map(enrich),creators:collapsed.has(s.id) && page==='search'?[]:(s.creators || []).map(row=>({...row,avatarKey:row.image?.key || '',image:undefined})),more:!collapsed.has(s.id)&&s.more}));
}
function emit() {
  if(dialog==='lyric-source' && target!==engine?.currentId()){dialog='';lyricSources.cancel()}
  if(dialog!=='lyric-source' && lyricSources.state.loading)lyricSources.cancel();
  dialogFeedback.sync(dialog,target);
  if(localIndexManager && indexLibraryRevision!==libraryRevision && (dialog.startsWith('recognition') || dialog.startsWith('local-index'))){indexLibraryRevision=libraryRevision;void localIndexManager.refresh();}
  if(!ui || updatePending)return;updatePending=true;
  queueMicrotask(()=>{
    updatePending=false;
    if(dialog!=='account-qr' && accountSession?.active)accountSession.close();
    if(dialog!=='bili-actions' && videoActions?.active)videoActions.close();
    try {
      const current=engine?decode(engine.currentTrackJson()):null;
      const activeBili=current?.id?.startsWith('bili-') && biliState?.request?.id==='bili-'+parseBilibiliId(track(current.id)?.remoteId)?.bvid?biliState:null;
      bridge.publish({ready,staticHosting:STATIC_HOSTING,page,viewKey:viewKey(),tab,songs:engine?cachedData('songs:'+page,`${libraryRevision}|${playlistRevision}|${tab}|${query}|${playlistId}|${preferences.sort}|${preferences.sortDescending}|${libraryGroup}|${libraryQuery}|${libraryPage}|${preferences.librarySource}|${preferences.libraryTag}|${preferences.recentTrackIds}`,()=>visibleSongs().map(enrich)):empty,
        playlists:engine?cachedData('playlists',`${libraryRevision}|${playlistRevision}`,()=>playlistsWithDetails()):empty,
        queue:engine&&queueOpen?cachedData('queue',`${libraryRevision}|${queueRevision}|${queueStart}`,()=>decode(engine.queueItemsJson(queueStart,240)).map(enrich)):empty,
        queueTotal:engine?.queueSize() || 0,queueOffset:queueStart,queueCurrentKey:engine?.currentQueueKey() || '',current:current?enrich(current):null,
        queueDuration:engine&&queueOpen?cachedData('queue-duration',`${libraryRevision}|${queueRevision}`,()=>engine.queueDurationMs()):0,queueLocked:preferences.queueLocked===true,queueFocus,queueUndo:queueOpen&&queueUndo&&cachedData('queue-undo',String(queueRevision),()=>engine.canUndoQueueEdit())?queueUndo:'',shuffle:engine?.shuffleEnabled() || false,
        lyrics:engine&&current?cachedData('lyrics',`${libraryRevision}|${current.id}`,()=>decode(engine.lyricsJson(current.id)).lines):empty,lyricSource:dialog==='lyric-source'?lyricSources.state:null,
        sections:cachedData('sections:'+page,`${libraryRevision}|${sectionRevision}|${source}|${preferences.searchPreference}|${[...collapsed].join(',')}`,selectedSections),query,source,searchKind,searchHistory:preferences.searchHistory || empty,player,queueOpen,status:playback?.status || 'idle',playbackHint:playback?.notice || '',
        libraryInfo:page==='library'?libraryPresentation():null,font:preferences.font || 'sans',motionPreset:preferences.motionPreset || 'fast',lyricsSize:preferences.lyricsSize || 26,guideEnabled:preferences.guideEnabled!==false,guideSeen:preferences.guideSeen || empty,
        theme:preferences.theme,dark:preferences.theme==='dark' || preferences.theme==='system'&&darkQuery.matches,reduceMotion:preferences.reduceMotion || reducedQuery.matches,
        autoOpen:preferences.autoOpen,volume:preferences.volume/100,repeat:engine?.repeatMode() || 'OFF',searchPreference:preferences.searchPreference,
        audioInfo:sound?.view(),audioDevices:sound?.output.rows || empty,
        recognition:dialog.startsWith('recognition')?recognition?.view():null,
        localIndex:dialog.startsWith('recognition') || dialog.startsWith('local-index')?localIndexManager?.view():null,
        busy,progress,message,toast,error,dialog,dialogError:dialogFeedback.error,target,targetQueueKey,dialogText,menuContext,playlistId,storage,backupText,updateAvailable,updatePrompt,updateApplying,webIntegration:webIntegration.view(),
        video:video?.state,danmaku:danmakuItems,live:live?.state,gallery:gallery.state,
        accounts:accountReader.state.value.accounts,accountSource,accountLoaded:accountReader.state.loaded,accountLoading:accountReader.state.loading,accountError:accountError || accountReader.state.error,accountChecking,accountChanging,
        login:accountSession?{...accountSession.state,qrRows:undefined}:null,qrRows:accountSession?.state.qrRows || empty,
        biliActions:videoActions?{...videoActions.state,folders:undefined,token:undefined}:null,biliActionFolders:videoActions?.state.folders || empty,
        webdav:webdav?{...webdav.view(),canSend:!!current && sources.includes(track(current.id)?.source) && !live?.active && !radio?.active}:undefined,
        transfer:lan?{...lan.view(),receipts:undefined}:undefined,transferQrRows:lan?.state.qrRows || empty,transferReceipts:lan?.state.receipts || empty,
        creator:creatorState?{...creatorState,songs:undefined,profile:{...creatorState.profile,hasArtwork:!!creatorState.profile.avatarUrl,avatarUrl:undefined}}:null,
        creatorSongs:creatorState?cachedData('creator-songs',`${libraryRevision}|${creatorRevision}`,()=>creatorState.songs.map(enrich)):empty,
        comments:commentState?cachedData('comments',String(commentRevision),()=>commentState.items.map(visualComment)):empty,
        commentInfo:commentState?{...commentState,items:undefined,subject:track(commentId)?enrich(track(commentId)):commentState.subject || null,parent:commentRoot?visualComment(commentPages.findComment(commentRoot,commentId) || {id:commentRoot,author:tr("Original comment"),text:''}):null}:null,
        creatorTab,followingTab,feedInfo:feedState?{...feedState,items:undefined,seen:undefined}:null,
        activities:feedState?cachedData('activities',`${libraryRevision}|${feedRevision}`,()=>feedState.items.map(visualActivity)):empty,
        activityDetails:dynamicState?.activity?cachedData('activity-detail',`${libraryRevision}|${dynamicRevision}`,()=>[visualActivity(dynamicState.activity)]):empty,
        dynamicInfo:dynamicState?{...dynamicState,activity:undefined,songs:undefined,items:undefined}:null,
        followingInfo:followingState?{...followingState,items:undefined,seen:undefined}:null,
        followingCreators:followingState?cachedData('following-creators',String(followingRevision),()=>followingState.items.map(row=>({...row,avatarKey:row.image?.key || '',image:undefined}))):empty,
        ...presenceSnapshot(),
        ...notesSnapshot(),noteEditor:noteEditor?.state,noteCount,
        ...radioSnapshot(),radioAdding,radioAddError,...cacheSnapshot(),
        statsInfo:{period:statsPeriod,offset:statsOffset,loading:statisticsPages?.state.loading || false,warning:statisticsPages?.state.warning || statsWarning,recording:preferences.recordListening!==false},statsReport:page==='statistics'?statisticsPages?.state.report || null:null,
        collectionInfo:collectionState?{...collectionState,songs:undefined,playlist:collectionState.playlist?{...collectionState.playlist,coverKey:collectionState.playlist.image?.key || '',image:undefined}:null}:null,
        collectionSongs:collectionState?cachedData('collection-songs',`${libraryRevision}|${collectionRevision}`,()=>collectionState.songs.map(enrich)):empty,
        importingCollection:!!importAbort,
        biliInfo:activeBili?{...activeBili,parts:undefined,collection:activeBili.collection?{...activeBili.collection,songs:undefined}:null}:null,
        biliParts:activeBili?cachedData('bili-parts',`${libraryRevision}|${biliRevision}`,()=>activeBili.parts?.map(row=>({...row,song:enrich(row.song)})) || empty):empty,
        biliCollectionSongs:activeBili?cachedData('bili-collection',`${libraryRevision}|${biliRevision}`,()=>activeBili.collection?.songs.map(enrich) || empty):empty,
        danmakuEnabled:preferences.danmakuEnabled,danmakuSize:preferences.danmakuSize,danmakuAlpha:preferences.danmakuAlpha,danmakuArea:preferences.danmakuArea,danmakuSpeed:preferences.danmakuSpeed,danmakuDensity:preferences.danmakuDensity,danmakuFps:preferences.danmakuFps,danmakuBlocked:preferences.danmakuBlocked});
    } catch(failure) {console.error('UI state update failed',failure);}
    liveHost?.overlay(dialog!=='' && !live?.state.fullscreen);
  });
}
function snapshotPreferences() {return {...preferences,radioStationId:radio?.active?radio.state.station.uuid:'',currentId:engine.currentId(),position:engine.positionMs(),queueIndex:engine.currentQueueIndex(),queue:cachedData('queue-ids',`${libraryRevision}|${queueRevision}`,()=>decode(engine.queueIdsJson())),repeat:engine.repeatMode(),shuffle:engine.shuffleEnabled()};}

function offerQueueUndo(text){queueUndo=text;clearTimeout(queueUndoTimer);queueUndoTimer=setTimeout(()=>{queueUndo='';engine.discardQueueUndo();emit()},8000);}
function visibleQueueEdit(request){return editVisibleQueueEntry(engine,request,{open:queueOpen,locked:preferences.queueLocked,keys:decode(engine.queueItemsJson(queueStart,240)).map(row=>row.queueKey)});}
function finishQueueEdit(result,playing){
  if(!result.changed)return;
  ++queueRevision;queueStart=Math.min(queueStart,Math.max(0,engine.queueSize()-1));
  if(result.removedCurrent){if(engine.currentId())playback.switchTo(engine.currentId(),{play:playing});else{playback.stop();navigation.update({player:false},{replace:true})}}
  dialog='';if(engine.canUndoQueueEdit())offerQueueUndo(tr("Removed from queue"));else queueUndo='';emit();persist();
}
function persist(immediate=false) {clearTimeout(prefsTimer);const save=()=>store.saveSettings(snapshotPreferences()).catch(()=>toastMessage(tr("Settings were not saved")));if(immediate)return save();prefsTimer=setTimeout(save,250);}
function applyLanguage(initial=false){const language=setLanguage(preferences.language);ui?.setUiLanguage(language,initial?JSON.stringify(languageMessages()):'');document.documentElement.lang=language;document.title=language==='zh-CN'?'听岚 · Web':'Tinglan · Web';dataCache.clear();}
function syncClock() {
  clearTimeout(clockTimer);if(!ui || !engine)return;
  const at=playback?.position() ?? engine.positionMs();
  ui.updateClock(at,engine.activeLyric(engine.currentId(),at));
  if(playback?.status==='playing' && !document.hidden) {
    const delay=player?Math.min(250,engine.lyricRefreshDelay(engine.currentId(),at,playback.audio.playbackRate)):500;
    clockTimer=setTimeout(syncClock,Math.max(50,delay));
  }
  if(Date.now()-lastClockSave>10_000) {lastClockSave=Date.now();persist();}
}
function chooseFiles(kind,accept,multiple=false,directory=false) {
  const input=document.createElement('input');input.type='file';input.accept=accept;input.multiple=multiple;input.hidden=true;
  if(directory)input.setAttribute('webkitdirectory','');
  input.addEventListener('change',()=>{handleFiles(kind,Array.from(input.files || [])).catch(e=>toastMessage(e.message));input.remove()},{once:true});
  input.addEventListener('cancel',()=>input.remove(),{once:true});document.body.append(input);input.click();
}
async function putRecord(record,file,art) {
  if(!records.has(record.id) && records.size>=LIMITS.tracks)throw new Error(tr("Library capacity is 10000 tracks"));
  await store.putTrack(record,file,art,{maxTracks:LIMITS.tracks});records.set(record.id,record);remote.delete(record.id);
  ++libraryRevision;
  engine.upsertTrack(record.id,record.title,record.artist,record.durationMs,record.favorite);if(record.lyrics)engine.setLyrics(record.id,record.lyrics);
}
async function ensureSaved(id) {
  if(records.has(id))return records.get(id);
  if(importReservation?.ids.has(id)){await importReservation.promise;if(records.has(id))return records.get(id);}
  if(savingTracks.has(id))return savingTracks.get(id);
  if(records.size+savingTracks.size+(importReservation?.ids.size || 0)>=LIMITS.tracks)throw new Error(tr("Library capacity is 10000 tracks"));
  const value=remote.get(id);if(!value)throw new Error(tr("Track metadata missing. Search again"));
  const task=(async()=>{
    const record=normalizeTrack({...value,size:0,type:'',cached:false,lyrics:'',addedAt:Date.now()});
    await store.putTrack(record,undefined,undefined,{maxTracks:LIMITS.tracks});
    const patch={favorite:!!value.favorite,durationMs:value.durationMs};
    if(patch.favorite!==record.favorite || patch.durationMs!==record.durationMs){await store.patchTrack(id,patch);Object.assign(record,patch)}
    records.set(id,record);remote.delete(id);++libraryRevision;engine.upsertMetadata(id,record.title,record.artist,record.durationMs,record.favorite);return record;
  })();savingTracks.set(id,task);
  try{return await task}finally{if(savingTracks.get(id)===task)savingTracks.delete(id)}
}
async function importMusic(files) {
  if(busy){toastMessage(tr("A task is running. Import again later"));return}busy=true;progress=0;let imported=0,failed=0;
  try {
    const music=files.filter(f=>/^audio\//.test(f.type) || /\.(mp3|m4a|aac|flac|wav|ogg|opus|aiff?|ape|wma)$/i.test(f.name));
    if(music.length+records.size>LIMITS.tracks)throw new Error(tr("Library capacity is 10000 tracks"));
    for(let index=0;index<music.length;index++) {
      const file=music[index];message=tr("Importing {0}/{1} · {2}", index+1, music.length, file.name);progress=index/music.length;emit();
      try {
        if(file.size>LIMITS.audio)throw new Error(tr("Track exceeds 512 MB"));
        const id=await fileIdentity(file);if(records.has(id))continue;
        let tags={};try{tags=await metadata.run('metadata',file)}catch{/* Filename remains usable for unsupported tags. */}
        const fallback=trackFromFile(file,id);
        const record=normalizeTrack({...fallback,...tags,title:tags.title || fallback.title,artist:tags.artist || fallback.artist,source:'local',cached:true,relativePath:file.webkitRelativePath || '',hasArtwork:!!tags.cover});
        let art;try{if(tags.cover)art=await resizeArtwork(tags.cover)}catch{record.hasArtwork=false}
        delete record.cover;await putRecord(record,file,art);++imported;
      } catch {++failed}
    }
    for(const file of files.filter(f=>/\.lrc$/i.test(f.name))) {
      const stem=(file.webkitRelativePath || file.name).replace(/\.lrc$/i,'');const found=[...records.values()].find(r=>(r.relativePath || r.filename).replace(/\.[^.]+$/,'')===stem);
      if(found && file.size<=600_000)await saveLyrics(found.id,await file.text(),false,'local');
    }
    toastMessage(tr("Imported {0} tracks{1}",imported,failed?tr(", {0} files incomplete",failed):''));await updateStorage();
  } finally {busy=false;progress=0;message='';emit();persist()}
}
async function handleFiles(kind,files) {
  if(!files.length)return;
  if(kind.startsWith('playlist-art:')){const id=kind.slice(13);if(!playlistMetadata.has(id))throw new Error(tr("Playlist no longer exists"));const [full,thumb]=await resizeArtwork(files[0]);await playlistEditor.run(id,old=>{if(!old)throw new Error(tr("Playlist no longer exists"));return {...old,background:'custom'};},value=>store.setPlaylistArtwork(value,full,thumb));toastMessage(tr("Playlist background saved"));return;}
  if(kind==='recognition'){if(dialog==='recognition')await recognition.start(files[0]);return;}
  if(kind==='music')return importMusic(files);
  if(kind==='backup')return prepareBackup(files[0]);
  if(kind==='lyrics') {
    if(files[0].size>600_000)throw new Error(tr("Lyrics file is too large"));
    const text=await files[0].text();await saveLyrics(target || engine.currentId(),text,true,'local');dialogText=text;dialog='lyrics-edit';emit();return;
  }
  if(kind==='art') {
    const id=target || engine.currentId();await ensureSaved(id);const [full,thumb]=await resizeArtwork(files[0]);await store.setArtwork(id,full,thumb);records.get(id).hasArtwork=true;++libraryRevision;
    invalidateCover(id);emit();toastMessage(tr("Artwork updated"));
  }
}
let fontRevision=0;
async function loadOptionalFont(value){const name={serif:'noto_serif_sc.otf',wenkai:'lxgw_wenkai_lite.ttf',nunito:'nunito_variable.ttf'}[value];if(!name)return;const response=await fetch('./composeResources/dev.tinglan.ui.generated.resources/font/'+name,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(tr("Unable to load font. Connect and retry"));await response.arrayBuffer();}
function invalidateCover(id) {for(const key of [id,id+':full']){coverFailures.delete(key);ui.deliverArtwork(key,'')}if(coversUrls.has(id)){URL.revokeObjectURL(coversUrls.get(id));coversUrls.delete(id)}}
async function sendCover(key) {
  if(/^radio-art-[a-f0-9-]{36}$/.test(key))return sendRadioCover(key);
  if(coversPending.has(key) || Date.now()-(coverFailures.get(key) || 0)<60_000)return;coversPending.add(key);
  const picture=pictureRequest(key),full=key.endsWith(':full'),id=picture?.id || (full?key.slice(0,-5):key);const value=track(id),publicAddress=contentImages.get(id),creator=/^creator-(qq|bili|netease)-([A-Za-z0-9]{1,40})$/.exec(id);if(!value && !creator && !publicAddress && !id.startsWith('playlist:')){coversPending.delete(key);return}
  try {
    let image=picture?null:await store.read('artwork',full?id:id+':thumb');
    if(!(image instanceof Blob) && (publicAddress || creator || value?.source!=='local' && value?.artworkUrl)) {
      const address=publicAddress || (creator?`/api/creator-artwork?${new URLSearchParams({source:creator[1],id:creator[2]})}`:`/api/artwork?id=${encodeURIComponent(id)}`);
      const response=await fetch(address,{signal:AbortSignal.timeout(15_000)});
      if(!response.ok)throw new Error('Cover unavailable');const raw=await response.blob();if(raw.size>LIMITS.artwork)throw new Error('Cover too large');
      if(picture)image=await resizeContentPicture(raw,picture.size);else{const pair=await resizeArtwork(raw);image=pair[full?0:1];if(records.has(id))await store.setArtwork(id,...pair);}
    }
    if(image instanceof Blob) {
      const bytes=new Uint8Array(await image.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=4096)binary+=String.fromCharCode(...bytes.subarray(i,i+4096));
      ui.deliverArtwork(key,btoa(binary));
      if(full && engine.currentId()===id){for(const url of coversUrls.values())URL.revokeObjectURL(url);coversUrls.clear();const url=URL.createObjectURL(image);coversUrls.set(id,url);playback.updateMediaMetadata(url)}
    }
  } catch {coverFailures.set(key,Date.now());while(coverFailures.size>160)coverFailures.delete(coverFailures.keys().next().value);/* A generated cover preserves a usable layout. */}
  finally {coversPending.delete(key)}
}
function loadAccountStates() {
  if(accountLoad)return accountLoad;
  accountError='';
  const operation=accountReader.refresh().then(async value=>{if(value?.changed && ready)await resetPlatformContent();}).finally(()=>{if(accountLoad===operation)accountLoad=null;emit();});
  accountLoad=operation;return operation;
}
function openAccounts(source='') {
  accountSession?.close();accountError='';
  navigation.update({page:'accounts',accountSource:sources.includes(source)?source:'',player:false,videoOpen:false,queueOpen:false});
}
async function checkAccount(id) {
  if(!sources.includes(id) || accountChecking || accountChanging || accountReader.state.loading)return;accountChecking=id;accountError='';emit();
  const generation=platform.generation;
  try {const value=await platform.request('/api/account/check',{method:'POST',body:{source:id},timeoutMs:60000});if(generation===platform.generation)accountReader.accept(value);}
  catch(error){if(generation===platform.generation && error.name!=='AbortError')accountError=error.message || tr("Account verification incomplete");}
  finally{accountChecking='';emit();}
}
async function changeAccount(id,cookie) {
  if(!sources.includes(id) || accountChanging || accountChecking)return;accountChanging=true;accountSession.close();emit();
  const owner=dialog;
  try {accountReader.accept(await platform.account(id,cookie));accountError='';await resetPlatformContent();if(dialog===owner && target===id){dialog='';dialogText='';}toastMessage(cookie?tr("Session connected. Verify account status"):tr("Signed out of platform"));}
  finally{accountChanging=false;emit();}
}
async function deliverLoginImage(key,path,signal) {
  if(!path){ui.deliverArtwork(key,'');return;}
  const response=await fetch(path,{credentials:'same-origin',signal,cache:'no-store'});
  if(!response.ok || response.headers.get('content-type')?.split(';')[0]!=='image/png')throw new Error(tr("Unable to load sign-in QR code"));
  const bytes=new Uint8Array(await response.arrayBuffer());signal?.throwIfAborted();
  if(bytes.length<100 || bytes.length>500000)throw new Error(tr("Invalid sign-in QR image"));
  let binary='';for(let i=0;i<bytes.length;i+=4096)binary+=String.fromCharCode(...bytes.subarray(i,i+4096));
  ui.deliverArtwork(key,btoa(binary));
}
async function hydrate() {
  const [saved,values,playlists,totalNotes]=await Promise.all([store.settings(),store.tracks(),store.playlists(),noteStore.count().catch(()=>null)]);if(totalNotes!==null)noteCount=totalNotes;engine.resetEngine();records.clear();playlistMetadata.clear();
  for(const value of values) {try{const record=normalizeTrack(value);if(engine.upsertTrack(record.id,record.title,record.artist,record.durationMs,record.favorite)){records.set(record.id,record);if(record.lyrics)engine.setLyrics(record.id,record.lyrics)}}catch{/* Preserve other readable tracks. */}}
  for(const p of playlists) {if(Array.isArray(p.trackIds)){engine.upsertPlaylist(p.id,p.name,[...new Set(p.trackIds.filter(id=>records.has(id)))].join('\n'),Number(p.createdAt)||0);playlistMetadata.set(p.id,p);}}
  preferences=normalizePreferences(saved,new Set(records.keys()));applyLanguage(true);if(preferences.font!=='sans'){try{await loadOptionalFont(preferences.font);}catch{preferences.font='sans';toastMessage(tr("Font unavailable. Using the default font"));}}if(preferences.queue.length){if(preferences.queueIndex>=0)engine.setQueueIdsAt(preferences.queue.join('\n'),preferences.queueIndex);else engine.setQueueIds(preferences.queue.join('\n'));}engine.setRepeatMode(preferences.repeat);engine.setShuffleEnabled(preferences.shuffle);
  if(preferences.currentId && (!preferences.queue.length || preferences.queue.includes(preferences.currentId)))engine.selectTrack(preferences.currentId);engine.setPosition(preferences.position);
  ++libraryRevision;++playlistRevision;++queueRevision;dataCache.clear();bridge.reset();
}
async function loadSections(scope,force=false,only='') {
  const revision=scope==='home'?++homeRevision:++searchRevision;const term=scope==='search'?searchTerm(query):'',kind=scope==='search'?searchKind:'songs';
  ++sectionRevision;
  if(scope==='search' && (!term || page!=='search')){searchSections=[];emit();return}
  if(scope==='search'){preferences.searchHistory=rememberSearch(preferences.searchHistory,term);persist();}
  const ids=only?[only]:(scope==='search' && source!=='all'?sources.filter(s=>s===source):sources);
  let sections=scope==='home'?homeSections:searchSections;
  for(const id of ids){const existing=sections.find(s=>s.id===id);if(!existing)sections.push({id,title:names[id],songs:[],creators:[],error:'',loading:true,more:false,page:1});else{existing.loading=true;existing.error=''}}emit();
  await Promise.allSettled(ids.map(async id=>{
    try {
      const data=await platform.catalog(id,term,1,{force,scope,kind});if(revision!==(scope==='home'?homeRevision:searchRevision))return;
      const section=sections.find(s=>s.id===id);section.songs=data.songs || [];section.creators=data.creators || [];section.more=data.more;section.page=1;section.error=data.warning || '';registerImages(data);
      for(const s of section.songs)if(!records.has(s.id))remote.set(s.id,s);trimRemote();
    } catch(failure) {if(failure.name==='AbortError' || revision!==(scope==='home'?homeRevision:searchRevision))return;sections.find(s=>s.id===id).error=failure.message || tr("Connection temporarily unavailable");}
    finally {if(revision===(scope==='home'?homeRevision:searchRevision)){sections.find(s=>s.id===id).loading=false;++sectionRevision;emit()}}
  }));
}
async function searchMore(id) {
  const section=searchSections.find(s=>s.id===id);if(page!=='search' || !searchTerm(query) || !section || section.loading || !section.more)return;
  const revision=searchRevision;const term=query;section.loading=true;++sectionRevision;emit();
  try{const data=await platform.catalog(id,term,section.page+1,{scope:'search',kind:searchKind});if(revision!==searchRevision)return;section.songs=[...new Map([...section.songs,...(data.songs || [])].map(s=>[s.id,s])).values()];section.creators=[...new Map([...(section.creators || []),...(data.creators || [])].map(row=>[row.id,row])).values()];section.more=data.more;++section.page;registerImages(data);for(const s of data.songs || [])if(!records.has(s.id))remote.set(s.id,s);trimRemote()}catch(e){if(revision===searchRevision)section.error=e.message}finally{if(revision===searchRevision){section.loading=false;++sectionRevision;emit()}}
}
function contextIds(context,id) {
  if(context==='library-view')return libraryData().allIds;
  if(context==='queue')return decode(engine.queueIdsJson());
  if(context==='cache')return cacheRows().map(row=>row.id);
  if(context.startsWith('playlist:'))return decode(engine.playlistJson(context.slice(9)))?.trackIds || [id];
  if(context.startsWith('section:'))return (page==='search'?searchSections:homeSections).find(s=>s.id===context.slice(8) && s.songs.some(t=>t.id===id))?.songs.map(s=>s.id) || [id];
  if(context.startsWith('creator:'))return creatorState?.songs.map(s=>s.id) || [id];
  if(context==='collection')return collectionState?.songs.map(song=>song.id) || [id];
  if(context==='activities')return (page==='dynamic'?dynamicState?.songs:feedState?.items.flatMap(row=>[row.song,row.original?.song]).filter(Boolean))?.map(song=>song.id) || [id];
  return visibleSongs().map(s=>s.id);
}
async function play(id,context='',ids,{position=0,guard=()=>true,queueKey='',queueIndex=-1}={}) {
  if(!guard())return false;
  if(radio?.active)await radio.close({resume:false});
  if(live?.active){await live.close({resume:false});liveHost.close();navigation.update({page:'home'},{replace:true});}
  if(!guard())return false;
  if(!track(id)){toastMessage(tr("Track metadata changed. Select it again"));return}
  if(importReservation)await importReservation.promise;
  if(!guard())return false;
  if(context==='queue' && (!queueKey || engine.queueEntryId(queueKey)!==id || !engine.selectQueueEntry(queueKey)))throw new Error(tr("Queue entry changed. Select it again"));
  error='';if(!engine.upsertTrack(id,track(id).title,track(id).artist,track(id).durationMs,track(id).favorite))throw new Error(tr("Library is full. Remove unwanted tracks and retry"));
  if(preferences.autoOpen && context!=='queue')navigation.update({player:true});
  engine.selectTrack(id);emit();
  if(context==='queue'){playback.switchTo(id,{position});persist();return;}
  const requested=context==='handoff'?(ids || [id]):[...new Set(ids || contextIds(context,id))];
  const candidates=requested.includes(id)?requested:[id];
  const wanted=candidates.filter(queuedId=>{const value=track(queuedId);return !!value && engine.upsertMetadata(value.id,value.title,value.artist,value.durationMs,value.favorite)});
  if(context==='handoff' && wanted.length!==requested.length)throw new Error(tr("Handoff queue not fully loaded. Receive it again"));
  if(!(context==='handoff'?engine.setQueueIdsAt(wanted.join('\n'),queueIndex):engine.setQueueIds(wanted.join('\n'))))throw new Error(tr("Unable to update playlist. Select it again"));
  if(wanted.length<candidates.length)toastMessage(tr("Added {0} tracks，{1} tracks could not be queued due to invalid metadata or capacity", wanted.length, candidates.length-wanted.length));
  ++queueRevision;
  playback.switchTo(id,{position});
  queueMetadata.select(wanted);persist();
  return true;
}
async function fetchLyrics(id,{force=false,background=false,sourceName='platform'}={}) {
  if(!background && !force && lastLyricsId===id)return;
  let signal;
  if(!background){lastLyricsId=id;lyricsController?.abort();lyricsController=new AbortController();signal=lyricsController.signal}
  const value=track(id);if(!value || value.source==='local'&&sourceName==='platform' || !force&&(value.lyricsEdited || value.lyrics))return;
  const revision=lyricsRevisions.get(id)||0;
  try{const result=await platform.lyrics(id,signal,sourceName,value);if(signal?.aborted || (!background && engine.currentId()!==id) || revision!==(lyricsRevisions.get(id)||0))return;if(result.text && await saveLyrics(id,result.text,false,result.source,revision))return result.text}
  catch(failure){if(force)throw failure;/* Audio remains usable if lyrics are temporarily unavailable. */}
}
async function saveLyrics(id,text,edited,sourceName,expectedRevision,owned=()=>true) {
  if(text.length>LIMITS.lyrics)throw new Error(tr("Lyrics are too large"));const record=await ensureSaved(id);
  if(!owned() || expectedRevision!==undefined && expectedRevision!==(lyricsRevisions.get(id)||0))return false;
  lyricsRevisions.set(id,(lyricsRevisions.get(id)||0)+1);
  const patch={lyrics:text,lyricsEdited:edited,lyricsSource:sourceName,originalLyrics:edited?(record.originalLyrics || record.lyrics):text};
  await store.patchTrack(id,patch);Object.assign(record,patch);engine.setLyrics(id,text);emit();syncClock();
  ++libraryRevision;return true;
}
async function favorite(id) {
  if(busy){toastMessage(tr("A task is running. Save again later"));return}
  const revision=(favoriteRevisions.get(id)||0)+1;favoriteRevisions.set(id,revision);
  const value=track(id);if(!value)return;const old=value.favorite;const desired=!old;value.favorite=desired;++libraryRevision;engine.upsertMetadata(id,value.title,value.artist,value.durationMs,desired);emit();
  try{const record=await ensureSaved(id);if(favoriteRevisions.get(id)!==revision)return;await store.patchTrack(id,{favorite:desired});if(favoriteRevisions.get(id)===revision){record.favorite=desired;emit()}}
  catch(e){const saved=await store.read('tracks',id).catch(()=>null);if(favoriteRevisions.get(id)===revision){const actual=saved?.favorite ?? old;value.favorite=actual;if(track(id))track(id).favorite=actual;++libraryRevision;engine.upsertMetadata(id,value.title,value.artist,value.durationMs,actual);if(actual!==desired)toastMessage(tr("Unable to save favorite"));emit()}}
}
async function updateStorage() {if(navigator.storage?.estimate){const data=await navigator.storage.estimate();storage=tr("{0} tracks · Used {1} MB{2}", records.size, ((data.usage||0)/1024/1024).toFixed(1), data.quota?` / ${Math.floor(data.quota/1024/1024)} MB`:'');}else storage=tr("{0} tracks", records.size);emit();}
function cacheProtected(){
  const ids=new Set();if(!engine)return ids;const current=engine.currentId();if(current)ids.add(current);
  let index=engine.currentQueueIndex()+1;if(index>=engine.queueSize() && engine.repeatMode()==='ALL')index=0;
  const next=index>=0 && index<engine.queueSize()?decode(engine.queueItemsJson(index,1))?.[0]?.id:null;if(next)ids.add(next);return ids;
}
function cacheRows(){return cachedData('cache-rows',`${libraryRevision}|${cacheFilter}`,()=>[...records.values()].filter(row=>row.source!=='local' && row.cached && (cacheFilter==='all' || cacheKind(row)===cacheFilter)).sort((a,b)=>(b.cacheSavedAt || b.addedAt)-(a.cacheSavedAt || a.addedAt) || a.id.localeCompare(b.id)));}
function cacheSnapshot(){
  const rows=page==='cache'?cacheRows():empty,pages=Math.max(1,Math.ceil(rows.length/CACHE_LIMITS.pageSize)),selected=Math.min(cachePage,pages-1);
  return {cacheInfo:{...mediaCache?.view(),filter:cacheFilter,page:selected,pages,count:rows.length},cacheTasks:mediaCache?.tasks || empty,
    cacheItems:page==='cache'?cachedData('cache-items',`${libraryRevision}|${cacheFilter}|${selected}`,()=>rows.slice(selected*CACHE_LIMITS.pageSize,(selected+1)*CACHE_LIMITS.pageSize).map(enrich)):empty};
}
function applyCacheUpdates(updates){
  for(const saved of updates){const row=records.get(saved.id);if(!row)continue;Object.assign(row,cachePatch(saved));
    if(!row.lyricsEdited && !row.lyrics && saved.lyrics){Object.assign(row,{lyrics:saved.lyrics,originalLyrics:saved.originalLyrics,lyricsSource:saved.lyricsSource});engine.setLyrics(row.id,row.lyrics);}
    if(saved.hasArtwork)row.hasArtwork=true;
  }++libraryRevision;emit();syncClock();
}
function cacheSong(id){
  if(accountChanging){toastMessage(tr("Account is switching. Download again later"));return;}
  const row=track(id);if(!row || row.source==='local'){toastMessage(tr("Local music is already saved in this browser"));return;}
  dialog='';emit();toastMessage(tr("Added to offline download queue"));
  mediaCache.request(id).then(()=>{const task=mediaCache.tasks.find(task=>task.id===id);toastMessage(task?.warning || tr("Downloaded with lyrics and available artwork"));}).catch(error=>{if(error.name!=='AbortError')toastMessage(error.name==='QuotaExceededError'?tr("Browser storage is full. Clear cache first"):error.message || tr("Download incomplete"));});
}
async function importCollection() {
  if(busy)throw new Error(tr("A task is running. Save the playlist later"));
  const request={source:collectionSource,id:collectionId},id=`collection-${request.source}-${request.id}`;
  if(decode(engine.playlistJson(id))){navigation.update({page:'library',tab:'playlists',playlistId:id,player:false,videoOpen:false});return;}
  const controller=new AbortController();importAbort=controller;busy=true;message=tr("Collecting playlist");progress=0;emit();
  let reservation;
  try {
    const plan=await collectPlaylist((...args)=>platform.collection(...args),request,{signal:controller.signal,progress:value=>{message=tr("Collecting playlist · Page {0}  · {1} tracks", value.page, value.received);progress=value.total?Math.min(.85,(value.received+value.unavailable)/value.total*.85):0;emit();}});
    await Promise.allSettled([...savingTracks.values()]);controller.signal.throwIfAborted();
    const wanted=[];
    for(let index=0;index<plan.songs.length;index++) {
      const song=plan.songs[index];wanted.push(normalizeTrack({...song,cached:false,size:0,type:'',lyrics:'',addedAt:Date.now()}));
      if(index>0 && index%200===0){await new Promise(resolve=>setTimeout(resolve,0));controller.signal.throwIfAborted();}
    }
    const newIds=new Set(wanted.filter(row=>!records.has(row.id)).map(row=>row.id));
    const engineIds=new Set([...records.keys(),...newIds,...decode(engine.queueIdsJson()),engine.currentId()].filter(Boolean));
    if(engineIds.size>LIMITS.tracks || decode(engine.playlistsJson()).length>=LIMITS.playlists)throw new Error(tr("Library is full. Remove tracks or playlists first"));
    let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});promise.catch(()=>{});reservation={ids:newIds,promise,resolve,reject};importReservation=reservation;
    message=tr("Saving complete playlist");progress=.9;emit();
    const playlist={id,name:plan.playlist.title.trim().slice(0,80) || tr("Platform playlists"),trackIds:wanted.map(row=>row.id),createdAt:Date.now()};
    const accepted=await store.importPlaylist(wanted,playlist,{signal:controller.signal});
    importAbort=null;for(const record of accepted)if(!records.has(record.id)){records.set(record.id,record);remote.delete(record.id);}trimRemote();
    for(let index=0;index<accepted.length;index++) {
      const row=records.get(accepted[index].id);engine.upsertMetadata(row.id,row.title,row.artist,row.durationMs,row.favorite);if(row.lyrics)engine.setLyrics(row.id,row.lyrics);
      if(index>0 && index%200===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    playlistMetadata.set(playlist.id,playlist);engine.upsertPlaylist(playlist.id,playlist.name,playlist.trackIds.join('\n'),playlist.createdAt);++libraryRevision;++playlistRevision;reservation.resolve();
    toastMessage(tr("Playlist saved: {0} available tracks{1}",wanted.length,plan.unavailable?tr(", {0} items unavailable",plan.unavailable):''));await updateStorage();persist();
  } catch(error){reservation?.reject(error);if(error.name==='AbortError')toastMessage(tr("Playlist save cancelled"));else throw error;}
  finally {if(importReservation===reservation)importReservation=null;if(importAbort===controller)importAbort=null;busy=false;message='';progress=0;emit();}
}
async function resetPlatformContent() {
  await mediaCache?.clear();
  radioPages?.accountChanged();
  presencePages?.clear();
  lan?.clear();if(page==='transfer' && !document.hidden)lan?.open();
  webdav?.clear();if(page==='webdav')webdav?.open();
  if(live?.active){await live.close({resume:false});liveHost.close();}
  importAbort?.abort();videoActions?.clear();danmakuSession.clear();creatorPages.clear();commentPages.clear();collectionPages.clear();biliPages.clear();biliState=null;++biliRevision;gallery.close();contentImages.clear();loadBiliContext();
  homeSections=[];searchSections=[];++homeRevision;++searchRevision;++sectionRevision;loadSections('home',true);
  feedPages.clear();dynamicPages.clear();followingPages.clear();feedState=null;dynamicState=null;followingState=null;++feedRevision;++dynamicRevision;++followingRevision;
  if(page==='creator')creatorPages.select(creatorSource,creatorId,creatorPage,{profileOnly:creatorSource==='bili' && creatorTab==='dynamics'});
  selectActivityRoute();
  if(page==='comments')commentPages.select({id:commentId,root:commentRoot,order:commentOrder,cursor:commentCursor});
  if(page==='collection')collectionPages.select({source:collectionSource,id:collectionId,page:collectionPage});
  if(page==='search' && query.trim())loadSections('search',true);if(videoOpen)openVideo();
  if(page==='live')openLive(false);
}
function handoffOwner() {return {id:engine.currentId(),key:engine.currentQueueKey(),queueRevision,queue:engine.queueIdsJson(),epoch:mediaEpoch,account:platform.accountRevision};}
function handoffStillOwned(owner) {return owner && owner.id===engine.currentId() && owner.key===engine.currentQueueKey() && owner.queueRevision===queueRevision && owner.queue===engine.queueIdsJson() && owner.epoch===mediaEpoch && owner.account===platform.accountRevision;}
function outgoingHandoff(identity) {
  if(radio?.active)throw new Error(tr("Live radio does not support handoff. Choose a platform track or video"));
  if(live?.active)throw new Error(tr("Live streams do not support handoff. Choose a platform track or video"));
  const queue=decode(engine.queueIdsJson()).map(track);
  return buildHandoff(queue,engine.currentId(),playback.position(),{...identity,currentIndex:engine.currentQueueIndex()});
}
async function prepareHandoff(plan) {
  if(importReservation)await importReservation.promise;
  const added=plan.metadata.filter(row=>!records.has(row.id)).length;
  if(records.size+added>LIMITS.tracks)throw new Error(tr("Not enough library space for this queue. Remove unwanted tracks first"));
}
async function continueHandoff(plan,owner) {
  if(!handoffStillOwned(owner))return false;
  await prepareHandoff(plan);if(!handoffStillOwned(owner))return false;
  const accepted=await store.importHandoff(plan.metadata.map(normalizeTrack));
  for(const row of accepted){records.set(row.id,row);remote.delete(row.id);}++libraryRevision;
  if(!handoffStillOwned(owner)){for(const row of accepted)engine.upsertMetadata(row.id,row.title,row.artist,row.durationMs,row.favorite);emit();return false;}
  playback.stop();engine.clearQueue();engine.releaseUnretained([...records.keys()].join('\n'));
  if(videoOpen)navigation.update({videoOpen:false},{replace:true});
  const committed=handoffOwner();return play(plan.currentId,'handoff',plan.ids,{position:plan.position,queueIndex:plan.index,guard:()=>handoffStillOwned(committed)});
}
function download(blob,name) {const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=name;link.hidden=true;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60_000);}
async function exportBackup() {
  if(busy)return;const revision=++backupRevision;busy=true;dialog='backup-progress';progress=0;message=tr("Reading library");emit();
  try{playback?.listeningSample();await listening?.flush();await playlistEditor.pending.catch(()=>{});const snapshot=await store.snapshot();if(revision!==backupRevision)return;snapshot.preferences=snapshotPreferences();const result=await backups.run('export',snapshot,value=>{progress=value.percent/100;message=value.phase;emit()});if(revision!==backupRevision)return;download(result.blob,tr("Tinglan backup-{0}.tinglan", new Date().toISOString().slice(0,10)));toastMessage(tr("Full backup download started"))}
  finally{if(revision===backupRevision){busy=false;dialog='';message='';emit()}}
}
async function prepareBackup(file) {
  if(busy)return;const revision=++backupRevision;busy=true;dialog='backup-progress';message=tr("Verifying backup");emit();
  try{const snapshot=await backups.run('import',file,value=>{progress=value.percent/100;message=value.phase;emit()});if(revision!==backupRevision)return;
    const mergedIds=new Set([...records.keys(),...snapshot.tracks.map(s=>s.id)]);const ps=new Set([...decode(engine.playlistsJson()).map(p=>p.id),...snapshot.playlists.map(p=>p.id)]);if(mergedIds.size>LIMITS.tracks || ps.size>LIMITS.playlists)throw new Error(tr("Merged library would exceed its limit"));
    pendingBackup=snapshot;backupText=tr("Backup contains {0} tracks、{1} playlists、{2} music notes、{3} listening records、{4} favorite stations, plus lyrics, artwork, and settings.\n\n Restore merges into the current library. Duplicate tracks use backup data; other tracks are kept. Notes merge by update time, preserving newer local edits.\n\n Backups include station URLs, not live audio or sign-in credentials.", snapshot.tracks.length, snapshot.playlists.length, snapshot.notes?.length || 0, snapshot.listening?.length || 0, snapshot.radioLibrary?.favorites?.length || 0);dialog='backup-confirm';
  }finally{if(revision===backupRevision){busy=false;message='';if(!pendingBackup)dialog='';emit()}}
}
async function restoreBackup() {
  if(live?.active){await live.close({resume:false});liveHost.close();navigation.update({page:'home'},{replace:true});}
  if(!pendingBackup || busy)return;busy=true;message=tr("Restoring library");emit();
  try{await mediaCache?.clear();if(radio?.active)await radio.close({resume:false});queueMetadata.clear();clearTimeout(prefsTimer);playback.pause();video?.close(undefined,true);danmakuSession?.clear();navigation.update({videoOpen:false},{replace:true});await listening?.flush();const snapshot=pendingBackup;const prefs=normalizePreferences(snapshot.preferences,new Set([...records.keys(),...snapshot.tracks.map(s=>s.id)]));await playlistEditor.pending.catch(()=>{});await store.mergeBackup(snapshot,prefs);notePages?.invalidate();noteEditor?.close();noteUpdates?.notify();playback.stop();await hydrate();recognition?.setMode(preferences.recognitionMode);await recognition?.open();sound?.configure(preferences.audioEffects);await mediaCache.maintain();await radios.load();radioPages?.invalidate();selectRadio();ui.clearArtwork();coverFailures.clear();remote.clear();pendingBackup=null;dialog='';lastLyricsId='';
    if(engine.currentId())await playback.switchTo(engine.currentId(),{play:false,position:preferences.position});sound.setVolume(preferences.volume/100);listening.setEnabled(preferences.recordListening!==false,track(engine.currentId()));statisticsChanged();toastMessage(tr("Restored. Playback stays paused"));await updateStorage();
  }finally{busy=false;message='';emit()}
}
async function dispatch(action,data='') {
  if(mediaActions.has(action)){recognition?.cancel();localIndexManager?.playbackIntent();}if(action==='backup-restore')localIndexManager?.cancel();
  if(action==='radio-qq-play' && radioPages?.state.loadingRadioId===data)return;
  if(mediaActions.has(action)){++mediaEpoch;radioPages?.cancelSelection();}
  if(radio?.active && !live?.active && ['toggle','next','previous','retry-play','queue-open'].includes(action)){if(action==='queue-open'){dialog='radio-queue';emit();}else if(action==='toggle')radio.toggle();else if(action==='next' || action==='previous')radio.change(action==='next'?1:-1);else radio.play();return;}
  const input=decode(data);
  if(live?.active && ['next','previous','toggle','seek','player-open','queue-open','retry-play'].includes(action)){await live.close({resume:false});liveHost.close();navigation.update({page:'home'},{replace:true});}
  if(busy && ['dialog-save','remove','playlist-delete','playlist-add','favorite','cache','lyrics-import','artwork-import'].includes(action)){toastMessage(tr("A task is running. Edit again later"));return}
  switch(action) {
    case 'reload':if(updates?.available)updates.activate();else location.reload();break;
    case 'update-dismiss': updates?.dismiss();break;
    case 'apply-update': {
      if(!updates?.available || updates.requested)break;
      const downloading=()=>mediaCache?.queue.jobs.size || mediaCache?.background?.jobs.size || mediaCache?.tasks.some(row=>['queued','preparing','downloading','saving'].includes(row.status));
      if(busy || downloading())throw new Error(tr("Finish or cancel the current task before updating"));
      if(mediaCache?.background?.supported){const state=await mediaCache.background.call('status');if(state.rows?.some(row=>['queued','preparing','downloading','saving'].includes(row.status)))throw new Error(tr("Finish or cancel background downloads before updating"));}
      if(busy || downloading())throw new Error(tr("Finish or cancel the current task before updating"));
      if(live?.active){await live.close({resume:false});liveHost.close();navigation.update({page:'home'},{replace:true});}
      radio?.pause();playback.pause();clearTimeout(prefsTimer);await store.saveSettings(snapshotPreferences());updates.activate();break;
    }
    case 'navigate': recognition?.cancel();navigation.update({page:data,playlistId:'',player:false,queueOpen:false,videoOpen:false});break;
    case 'webdav-open': navigation.update({page:'webdav',player:false,queueOpen:false,videoOpen:false});break;
    case 'webdav-refresh': await webdav.refresh();break;
    case 'webdav-connect': await webdav.connect(input);break;
    case 'webdav-forget': await webdav.forget();break;
    case 'webdav-publish': await webdav.publish();break;
    case 'webdav-claim': await webdav.claim();break;
    case 'webdav-resume': await webdav.resumeReceived();break;
    case 'transfer-open': navigation.update({page:'transfer',player:false,queueOpen:false,videoOpen:false});break;
    case 'transfer-refresh': await lan.open();break;
    case 'transfer-start': await lan.start(data);break;
    case 'transfer-stop': await lan.stop();break;
    case 'transfer-retry': await lan.retry(data);break;
    case 'transfer-copy': if(lan.state.active && lan.rawUrl){await clipboardWriter.write(lan.rawUrl);toastMessage(tr("Receiver address copied"));}break;
    case 'page-back': navigation.back();break;
    case 'creator-open': {const song=track(data || engine.currentId());if(song?.creatorId)navigation.update({page:'creator',creatorId:song.creatorId,creatorSource:song.source,creatorPage:1,creatorTab:song.source==='bili'?'dynamics':'works',player:false,videoOpen:false,queueOpen:false});break;}
    case 'creator-direct': if(sources.includes(input?.source) && input?.id)navigation.update({page:'creator',creatorSource:input.source,creatorId:input.id,creatorPage:1,creatorTab:input.source==='bili'?'dynamics':'works',player:false,videoOpen:false,queueOpen:false});break;
    case 'creator-tab': if(creatorSource==='bili')navigation.update({creatorTab:data==='dynamics'?'dynamics':'works',creatorPage:1},{replace:true});break;
    case 'following-open': navigation.update({page:'following',followingTab:'dynamics',player:false,videoOpen:false,queueOpen:false});break;
    case 'live-open': {const id=liveRoomFromLink(data);if(!id)throw new Error(tr("Enter a room ID or complete Bilibili live-stream URL"));navigation.update({page:'live',liveRoomId:id,player:false,videoOpen:false,queueOpen:false});break;}
    case 'live-bounds': if(page==='live' && input?.id===liveRoomId)liveHost.bounds(input);break;
    case 'live-mute':liveHost.video.muted=!liveHost.video.muted;live.patch({muted:liveHost.video.muted});break;
    case 'live-toggle': live.toggle();break;
    case 'live-retry': if(page==='live')openLive(false);break;
    case 'live-fullscreen': await liveHost.fullscreen();break;
    case 'live-quality-menu': dialog='live-quality';emit();break;
    case 'live-quality': {const quality=Number(data);if(!live.state.qualities.some(q=>q.id===quality))break;preferences.liveQuality=quality;persist();if(page==='live')live.open(liveRoomId,quality,{play:live.desired || live.state.status==='error'});break;}
    case 'following-tab': navigation.update({followingTab:['creators','live'].includes(data)?data:'dynamics'},{replace:true});break;
    case 'gallery-open':gallery.open(input?.keys,Number(input?.index));break;
    case 'gallery-select':await gallery.select(Number(data));break;
    case 'gallery-step':await gallery.step(Number(data));break;
    case 'gallery-retry':await gallery.select(gallery.state.index,{retry:true});break;
    case 'gallery-close':gallery.close();break;
    case 'dynamic-open': if(/^[1-9][0-9]{0,23}$/.test(data))navigation.update({page:'dynamic',dynamicId:data,player:false,videoOpen:false,queueOpen:false});break;
    case 'dynamic-refresh': if(dynamicId)await dynamicPages.select({id:dynamicId},{force:true});break;
    case 'dynamic-comments': if(/^[1-9][0-9]{0,23}$/.test(data))navigation.update({page:'comments',commentId:'bili-dynamic-'+data,commentRoot:'',commentOrder:'hot',commentCursor:'',player:false,videoOpen:false,queueOpen:false});break;
    case 'feed-refresh': selectActivityRoute(true);break;
    case 'presence-refresh': selectPresence(true);break;
    case 'feed-more': await feedPages.more();break;
    case 'followings-more': await followingPages.more();break;
    case 'creator-page': navigation.update({creatorPage:Math.max(1,Math.min(100,Number(data)))},{replace:true});break;
    case 'creator-refresh': selectPresence(true);await creatorPages.select(creatorSource,creatorId,creatorPage,{force:true,profileOnly:creatorSource==='bili' && creatorTab==='dynamics'});if(creatorTab==='dynamics')selectActivityRoute(true,{presence:false});break;
    case 'tab': clearTimeout(libraryQueryTimer);navigation.update({tab:data,playlistId:'',libraryGroup:'',libraryQuery:'',libraryPage:0},{replace:true});break;
    case 'library-group': navigation.update({page:'library',libraryGroup:data,libraryQuery:'',libraryPage:0});break;
    case 'library-back': if(playlistId)navigation.close('playlistId');else if(libraryGroup)navigation.close('libraryGroup');else navigation.update({tab:'overview',libraryQuery:'',libraryPage:0},{replace:true});break;
    case 'library-query': {clearTimeout(libraryQueryTimer);const owner=[tab,playlistId,libraryGroup].join('|');libraryQueryTimer=setTimeout(()=>{if(page==='library' && owner===[tab,playlistId,libraryGroup].join('|'))navigation.update({libraryQuery:data.slice(0,200),libraryPage:0},{replace:true})},250);break;}
    case 'library-page': navigation.update({libraryPage:Number(data)||0},{replace:true});break;
    case 'library-setting': {const key=input?.key,value=input?.value;if(key==='sort' && SONG_SORTS.includes(value))preferences.sort=value;else if(key==='sortDescending')preferences.sortDescending=value==='true';else if(key==='libraryView')preferences.libraryView=value==='grid'?'grid':'list';else if(key==='librarySource' && ['all',...sources,'local'].includes(value))preferences.librarySource=value;else if(key==='libraryTag')preferences.libraryTag=String(value).slice(0,32);else if(key==='libraryOrder')preferences.libraryOrder=libraryOrder(String(value).split(','));else break;navigation.update({libraryPage:0},{replace:true});emit();persist();break;}
    case 'library-play': {const ids=libraryData().allIds;if(ids.length){if(data==='shuffle'){engine.setShuffleEnabled(true);engine.setRepeatMode('ALL');}await play(data==='shuffle'?ids[Math.floor(Math.random()*ids.length)]:ids[0],'library-view',ids);}break;}
    case 'library-bulk': {if(input?.stamp!==libraryStamp())throw new Error(tr("The page changed. Select the track again"));const allowed=new Set(libraryData().allIds),ids=[...new Set(String(input.ids || '').split('\n'))].filter(id=>allowed.has(id)).slice(0,10000);if(!ids.length)break;if(input.kind==='playlist'){target='';menuContext='bulk';dialogText=ids.join('\n');dialog='playlist-add';emit();break;}if(input.kind==='remove' && playlistId){await playlistEditor.membership(playlistId,ids,true);}else if(input.kind==='queue'){if(decode(engine.queueIdsJson()).length+ids.length>LIMITS.tracks)throw new Error(tr("Queue capacity is insufficient. Select fewer tracks"));for(const id of ids)if(!engine.insertQueueTrack(id,false))throw new Error(tr("Queue is full"));++queueRevision;persist();}else if(input.kind==='favorite'){const owners=new Map(ids.map(id=>{const rev=(favoriteRevisions.get(id)||0)+1;favoriteRevisions.set(id,rev);return [id,rev];}));await store.favoriteTracks(ids);for(const id of ids){const row=records.get(id);if(row && favoriteRevisions.get(id)===owners.get(id)){row.favorite=true;engine.upsertMetadata(id,row.title,row.artist,row.durationMs,true);}}++libraryRevision;}else if(input.kind==='download'){for(const id of ids.slice(0,20))await cacheSong(id);}else break;emit();toastMessage(input.kind==='download' && ids.length>20?tr("Submitted the first 20 downloads. Add more after they finish"):tr("Processed ")+ids.length+tr(" tracks"));break;}
    case 'playlist-sort-move': {if(input?.id!==playlistId || preferences.sort!=='custom' || preferences.sortDescending || libraryQuery || preferences.librarySource!=='all')throw new Error(tr("Choose custom order and clear filters before reordering"));await playlistEditor.move(input.id,input.songId,input.destinationId);break;}
    case 'pwa-later':webIntegration.dismiss();break;
    case 'pwa-install':if(!await webIntegration.install()){dialog='web-integration';emit();}break;
    case 'notifications-enable':{const permission=await webIntegration.notifications();if(permission==='granted')toastMessage(tr("Download notifications enabled"));await store.write(['settings'],tx=>tx.objectStore('settings').put(permission==='granted','systemNotifications'));break;}
    case 'notifications-disable':webIntegration.disableNotifications();await store.write(['settings'],tx=>tx.objectStore('settings').put(false,'systemNotifications'));break;
    case 'search-query': query=data.slice(0,200);clearTimeout(searchTimer);++searchRevision;++sectionRevision;searchSections=[];trimRemote();for(const s of sources)platform.cancel('search:'+s);emit();if(searchTerm(query))searchTimer=setTimeout(()=>loadSections('search'),450);break;
    case 'search-composing':clearTimeout(searchTimer);++searchRevision;for(const id of sources)platform.cancel('search:'+id);break;
    case 'search-submit':clearTimeout(searchTimer);if(searchTerm(query))await loadSections('search');break;
    case 'search-history-use': {const term=searchTerm(data);if(!term)break;navigation.update({page:'search',player:false,queueOpen:false,videoOpen:false});await dispatch('search-query',term);clearTimeout(searchTimer);await loadSections('search');break;}
    case 'search-history-remove':preferences.searchHistory=forgetSearch(preferences.searchHistory,data);persist();emit();break;
    case 'search-history-clear':dialog='search-history-clear';emit();break;
    case 'search-history-clear-confirm':preferences.searchHistory=[];persist();dialog='';emit();break;
    case 'search-source': source=data;collapsed.clear();emit();if(query.trim())loadSections('search');break;
    case 'search-kind': if(['songs','creators'].includes(data) && searchKind!==data){searchKind=data;clearTimeout(searchTimer);++searchRevision;++sectionRevision;searchSections=[];for(const id of sources)platform.cancel('search:'+id);trimRemote();emit();if(query.trim())loadSections('search');}break;
    case 'search-retry': await loadSections('search',true,data);break;
    case 'search-more': await searchMore(data);break;
    case 'comments-open': {const song=track(data || engine.currentId());if(song && song.source!=='local')navigation.update({page:'comments',commentId:song.id,commentRoot:'',commentOrder:'hot',commentCursor:'',player:false,videoOpen:false,queueOpen:false});break;}
    case 'comments-order': navigation.update({commentOrder:data==='new'?'new':'hot',commentRoot:'',commentCursor:''},{replace:true});break;
    case 'comments-replies': if(commentPages.findComment(data,commentId))navigation.update({commentRoot:data,commentCursor:''});break;
    case 'comments-more': if(commentState?.next)navigation.update({commentCursor:commentState.next});break;
    case 'comments-refresh': await commentPages.select({id:commentId,root:commentRoot,order:commentOrder,cursor:commentCursor},{force:true});break;
    case 'collection-link': dialog='collection-link';dialogText='';emit();break;
    case 'collection-open': {const link=parseCollectionLink(input?.text || '',input?.source || 'qq');if(!link)throw new Error(tr("Paste a complete playlist URL, or choose a platform and enter its playlist ID ID"));navigation.update({page:'collection',collectionSource:link.source,collectionId:link.id,collectionPage:1,player:false,videoOpen:false,queueOpen:false});break;}
    case 'collection-page': navigation.update({collectionPage:Math.max(1,Math.min(500,Number(data)))},{replace:true});break;
    case 'collection-refresh': await collectionPages.select({source:collectionSource,id:collectionId,page:collectionPage},{force:true});break;
    case 'collection-import': await importCollection();break;
    case 'collection-cancel': importAbort?.abort();break;
    case 'collapse': if(collapsed.has(data))collapsed.delete(data);else collapsed.add(data);emit();break;
    case 'refresh-home': await loadSections('home',true);break;
    case 'refresh-source': await loadSections('home',true,data);break;
    case 'play': await play(input.id,input.context || '',undefined,{queueKey:input.queueKey || ''});break;
    case 'play-group': {const ids=[...records.values()].filter(s=>input.kind==='albums'?(s.album || tr("Unknown album"))===input.name:s.artist===input.name).map(s=>s.id);if(ids.length)await play(ids[0],'',ids);break;}
    case 'toggle': error='';playback.toggle();emit();break;
    case 'previous': error='';playback.previous();break;
    case 'next': error='';playback.next();break;
    case 'seek': playback.seek(Number(data));syncClock();persist();break;
    case 'seek-track': if(seekCurrentTrack(engine,playback,input)){syncClock();persist()}break;
    case 'repeat': engine.setRepeatMode({OFF:'ALL',ALL:'ONE',ONE:'OFF'}[engine.repeatMode()]);emit();persist();break;
    case 'playback-order': if(['OFF','ALL','ONE','SHUFFLE'].includes(data)){engine.setShuffleEnabled(data==='SHUFFLE');engine.setRepeatMode(data==='SHUFFLE'?'ALL':data);emit();persist()}break;
    case 'favorite': await favorite(data);break;
    case 'player-open': navigation.update({player:true});break;
    case 'player-close': navigation.close('player');break;
    case 'artwork-origin': if(input?.id===engine.currentId())coverOrigin=input;break;
    case 'video-open': if(track(engine.currentId())?.source==='bili')navigation.update({player:true,videoOpen:true});break;
    case 'bili-context-open': if(track(engine.currentId())?.source==='bili'){dialog='bili-context';loadBiliContext();emit();}break;
    case 'bili-actions-open': {const song=track(data || target || engine.currentId());if(song?.source==='bili'){target=song.id;dialog='bili-actions';emit();await videoActions.open(song.id);}break;}
    case 'bili-actions-refresh': if(dialog==='bili-actions')await videoActions.open(target,{force:true});break;
    case 'bili-actions-like': if(dialog==='bili-actions')await videoActions.like();break;
    case 'bili-actions-choose': if(dialog==='bili-actions')videoActions.choose(data);break;
    case 'bili-actions-save': if(dialog==='bili-actions')await videoActions.favorites();break;
    case 'bili-actions-account': videoActions.close();openAccounts('bili');await loadAccountStates();break;
    case 'bili-context-refresh': loadBiliContext(true);break;
    case 'bili-context-collection': if(biliState?.collection?.id)navigation.update({page:'collection',collectionSource:'bili',collectionId:biliState.collection.id,collectionPage:1,player:false,videoOpen:false,queueOpen:false});break;
    case 'bili-context-play': {
      const plan=planBilibiliSelection(biliState,engine.currentId(),input?.id,input?.group);
      dialog='';
      for(const row of plan.songs)if(!records.has(row.id))remote.set(row.id,row);
      if(plan.same){for(const id of plan.ids){const row=track(id);if(!row || !engine.upsertMetadata(row.id,row.title,row.artist,row.durationMs,row.favorite))throw new Error(tr("Library is full. Remove tracks first"));}engine.setQueueIds(plan.ids.join('\n'));++queueRevision;queueMetadata.select(plan.ids);persist();emit();}
      else await play(plan.id,'bili-context',plan.ids);
      break;
    }
    case 'video-close': navigation.close('videoOpen');break;
    case 'video-retry': if(videoOpen)openVideo();break;
    case 'video-fullscreen': await videoHost.fullscreen();break;
    case 'video-rate': video.setRate(Number(data));break;
    case 'video-quality': {const quality=Number(data);if(![16,32,64,74,80,112,116,120,125,126,127].includes(quality))break;preferences.biliQuality=quality;persist();if(videoOpen)openVideo();break;}
    case 'danmaku-toggle': preferences.danmakuEnabled=!preferences.danmakuEnabled;danmakuSession.select(videoOpen?engine.currentId():'',preferences.danmakuEnabled);emit();persist();break;
    case 'danmaku-setting': {if(!['danmakuSize','danmakuAlpha','danmakuArea','danmakuSpeed','danmakuDensity','danmakuFps','danmakuBlocked'].includes(input?.key))break;preferences=normalizePreferences({...preferences,[input.key]:input.key==='danmakuBlocked'?input.value:Number(input.value)});emit();persist();break;}
    case 'queue-open': queueStart=Math.max(0,engine.currentQueueIndex()-120);++queueFocus;navigation.update({queueOpen:true});break;
    case 'queue-close': navigation.close('queueOpen');break;
    case 'queue-locate': if(queueOpen){queueStart=Math.max(0,engine.currentQueueIndex()-120);++queueFocus;emit()}break;
    case 'queue-lock': preferences.queueLocked=!preferences.queueLocked;emit();persist();break;
    case 'queue-play': if(queueOpen && input?.key && engine.queueEntryId(input.key)===input.id){if(input.key===engine.currentQueueKey()){playback.toggle();emit()}else await play(input.id,'queue',undefined,{queueKey:input.key})}break;
    case 'queue-move': {const result=editQueueEntry(engine,{...input,action:'move',delta:Number(input?.delta)},{active:dialog==='song-menu' && menuContext==='queue',key:targetQueueKey,id:target,locked:preferences.queueLocked});finishQueueEdit(result,playback.desiredPlaying);break;}
    case 'queue-play-next': {const result=editQueueEntry(engine,{...input,action:'next'},{active:dialog==='song-menu' && menuContext==='queue',key:targetQueueKey,id:target,locked:preferences.queueLocked});finishQueueEdit(result,playback.desiredPlaying);break;}
    case 'queue-remove': {const playing=playback.desiredPlaying,result=editQueueEntry(engine,{...input,action:'remove'},{active:dialog==='song-menu' && menuContext==='queue',key:targetQueueKey,id:target,locked:preferences.queueLocked});finishQueueEdit(result,playing);break;}
    case 'queue-dismiss': case 'queue-nudge': case 'queue-reorder': {const playing=playback.desiredPlaying,result=visibleQueueEdit({...input,action:action==='queue-dismiss'?'remove':action==='queue-nudge'?'move':'move-to',delta:Number(input?.delta)});finishQueueEdit(result,playing);break;}
    case 'queue-next': case 'queue-add': {const id=data || target,revision=queueRevision,active=engine.currentQueueKey(),record=await ensureSaved(id);if(revision!==queueRevision || action==='queue-next'&&active!==engine.currentQueueKey())throw new Error(tr("Queue changed. Select tracks to add again"));if(!engine.upsertMetadata(record.id,record.title,record.artist,record.durationMs,record.favorite) || !engine.insertQueueTrack(id,action==='queue-next'))throw new Error(tr("Queue is full"));++queueRevision;dialog='';emit();persist();toastMessage(action==='queue-next'?tr("Set to play next"):tr("Added to queue"));break;}
    case 'queue-clear': if(queueOpen && !preferences.queueLocked){const removed=engine.clearOtherQueueEntries();if(removed){++queueRevision;queueStart=0;offerQueueUndo(tr("Cleared the other {0} tracks", removed));emit();persist()}}break;
    case 'queue-undo': if(queueOpen && !preferences.queueLocked){const before=engine.currentQueueKey(),playing=playback.desiredPlaying;if(engine.undoQueueEdit()){clearTimeout(queueUndoTimer);queueUndo='';++queueRevision;queueStart=Math.max(0,engine.currentQueueIndex()-120);++queueFocus;if(before!==engine.currentQueueKey() && engine.currentId())playback.switchTo(engine.currentId(),{play:playing});emit();persist()}}break;
    case 'queue-before': queueStart=Math.max(0,queueStart-240);emit();break;
    case 'queue-after': queueStart=Math.min(Math.max(0,engine.queueSize()-1),queueStart+240);emit();break;
    case 'cover': await sendCover(data);break;
    case 'import': chooseFiles('music','audio/*,.mp3,.flac,.m4a,.wav,.ogg,.lrc',true);break;
    case 'import-folder': chooseFiles('music','',true,true);break;
    case 'artwork-import': target=data || target;chooseFiles('art','image/*');break;
    case 'lyrics-import': chooseFiles('lyrics','.lrc,text/plain');break;
    case 'copy': toastMessage(tr("Copying lyrics…"));await clipboardWriter.write(data);toastMessage(tr("Lyrics copied"));break;
    case 'content-copy': toastMessage(tr("Copying…"));await clipboardWriter.write(data);toastMessage(tr("Copied"));break;
    case 'lyrics-export': download(new Blob([data],{type:'text/plain;charset=utf-8'}),`${track(target)?.title || tr("Lyrics")}.lrc`);toastMessage(tr("Lyrics export started"));break;
    case 'lyrics-edit': target=data || target || engine.currentId();dialog='lyrics-edit';dialogText=track(target)?.lyrics || '';emit();break;
    case 'lyric-source': dialog='lyric-source';target=engine.currentId();lyricSources.open(track(target));emit();break;
    case 'lyrics-source': if(dialog==='lyric-source')await lyricSources.select(data);break;
    case 'lyrics-source-match': if(dialog==='lyric-source' && input?.id===target)await lyricSources.select('kugou',input);break;
    case 'song-menu': target=input.id;targetQueueKey=input.queueKey || '';menuContext=input.context || '';dialog='song-menu';dialogText='';emit();break;
    case 'radio-open':navigation.update({page:'radio',player:false,videoOpen:false,queueOpen:false});break;
    case 'radio-scope':navigation.update({radioScope:data,radioQuery:''},{replace:true});break;
    case 'radio-query':navigation.update({radioQuery:data.slice(0,120)},{replace:true});break;
    case 'radio-refresh':await radios.load().catch(e=>{radioStorageError=e.message;});selectRadio(true);break;
    case 'radio-more':radioPages.more();break;
    case 'radio-play':case 'radio-queue-play':{const station=findRadio(data);if(!station)throw new Error(tr("Station metadata changed. Select it again"));radioPages.cancelSelection();if(live?.active){await live.close({resume:false});liveHost.close();}if(videoOpen)navigation.update({videoOpen:false},{replace:true});const queue=action==='radio-queue-play'?radio.state.queue:(radioPages.state.items.filter(row=>row.uuid));dialog='';if(preferences.autoOpen)navigation.update({player:true});radio.open(station,{queue});emit();break;}
    case 'radio-qq-play':radioPages.chooseQq(data);break;
    case 'radio-toggle':radio.toggle();break;
    case 'radio-next':radio.change(1);break;
    case 'radio-previous':radio.change(-1);break;
    case 'radio-close':if(live?.active){await live.close({resume:false});liveHost.close();}await radio.close();if(!engine.currentId())navigation.close('player');emit();break;
    case 'radio-favorite':{const station=findRadio(data);if(!station)throw new Error(tr("Station metadata updated"));await radios.toggle(station);toastMessage(radios.value.favorites.includes(station.uuid)?tr("Station saved to favorites"):tr("Station removed from favorites"));break;}
    case 'radio-add':{if(radioAdding)return;const token=++radioAddVersion;radioAdding=true;radioAddError='';emit();try{const value=await platform.request('/api/radio-custom',{method:'POST',body:input});if(token!==radioAddVersion || dialog!=='radio-custom')return;await radios.toggle(value.station,true);if(token!==radioAddVersion)return;dialog='';navigation.update({page:'radio',radioScope:'favorites',radioQuery:'',player:false},{replace:true});toastMessage(tr("Station saved"));}catch(error){if(token===radioAddVersion)radioAddError=error.message;}finally{if(token===radioAddVersion){radioAdding=false;emit();}}break;}
    case 'statistics-open':navigation.update({page:'statistics',player:false,videoOpen:false,queueOpen:false});break;
    case 'statistics-period':navigation.update({statsPeriod:data,statsOffset:0},{replace:true});break;
    case 'statistics-offset':navigation.update({statsOffset:Number(data)},{replace:true});break;
    case 'statistics-refresh':playback?.listeningSample();await listening?.flush();selectStatistics(true);break;
    case 'statistics-play':if(track(data))await play(data,'statistics');else toastMessage(tr("Track is no longer in the library. Search again to play it"));break;
    case 'statistics-reset-confirm':dialog='';listening?.reset();await listeningStore.reset();listening?.begin(track(engine.currentId()));statisticsChanged('reset');toastMessage(tr("Local listening statistics cleared"));break;
    case 'notes-open': {const filter=notePages.current?.request || {query:'',category:'',page:0};navigation.update({page:'notes',notesQuery:filter.query,notesCategory:filter.category,notesPage:filter.page,player:false,videoOpen:false,queueOpen:false});break;}
    case 'notes-query': navigation.update({notesQuery:data.slice(0,128),notesPage:0},{replace:true});break;
    case 'notes-category': navigation.update({notesCategory:data.slice(0,32),notesPage:0},{replace:true});break;
    case 'notes-page': navigation.update({notesPage:Number(data)},{replace:true});break;
    case 'notes-refresh': selectNotesRoute({force:true});break;
    case 'note-open': {if(!data)break;target=data;dialog='note-editor';await noteEditor.open(data,track(data));break;}
    case 'note-reload': if(input?.token===noteEditor.state.token){dialog='note-editor';await noteEditor.open(noteEditor.state.songId,track(noteEditor.state.songId));}break;
    case 'note-save': {const token=input?.token;if(dialog==='note-editor' && await noteEditor.save(input) && noteEditor.state.token===token){dialog='';noteEditor.close();toastMessage(tr("Music note saved locally"));}break;}
    case 'note-delete': if(data===noteEditor.state.token && noteEditor.state.exists){dialog='note-delete';emit();}break;
    case 'note-editor-return': if(data===noteEditor.state.token){dialog='note-editor';emit();}break;
    case 'note-delete-confirm': if(dialog==='note-delete' && await noteEditor.remove(data) && noteEditor.state.token===data){dialog='';noteEditor.close();toastMessage(tr("Music note deleted"));}break;
    case 'metadata-open': dialog='metadata';{const song=track(target);dialogText=[song?.title,song?.artist,song?.album].join('\n')}emit();break;
    case 'dialog': recognition?.cancel();if(data==='accounts'){openAccounts();await loadAccountStates();break;}if(data==='lyrics-source')target=engine.currentId();dialog=data;if(data==='playlist-create')playlistCreateId='playlist-'+crypto.randomUUID();dialogText='';noteEditor?.close();emit();break;
    case 'dialog-close': recognition?.cancel();accountSession?.close();dialog='';dialogText='';pendingBackup=null;noteEditor?.close();emit();break;
    case 'recognition-open': dialog='recognition';emit();await Promise.all([recognition.open(),localIndexManager.refresh()]);break;
    case 'recognition-mode': if(['auto','offline','online'].includes(data)){recognition.setMode(data);preferences.recognitionMode=data;persist();emit();}break;
    case 'local-index-open': if(!recognition.busy){dialog='local-index';emit();await localIndexManager.refresh();}break;
    case 'local-index-build': await localIndexManager.build();break;
    case 'local-index-refresh': await localIndexManager.refresh();break;
    case 'local-index-cancel': localIndexManager.cancel();break;
    case 'local-index-clear': dialog='local-index-clear';emit();break;
    case 'local-index-clear-confirm': if(dialog==='local-index-clear'){recognition.cancel();await localIndexManager.clear();dialog='local-index';emit();}break;
    case 'recognition-start': if(dialog==='recognition')await recognition.start();break;
    case 'recognition-file': if(dialog==='recognition' && !recognition.busy)chooseFiles('recognition','audio/*,.mp3,.m4a,.aac,.ogg,.opus,.flac,.wav,.webm,.mp4');break;
    case 'recognition-cancel': recognition.cancel();break;
    case 'recognition-query': recognition.filter(data);break;
    case 'recognition-page': recognition.filter(recognition.query,Number(data));break;
    case 'recognition-clear': if(dialog==='recognition' && !recognition.busy){dialog='recognition-clear';emit();}break;
    case 'recognition-clear-confirm': if(dialog==='recognition-clear'){await recognition.clear();dialog='recognition';emit();}break;
    case 'recognition-play': {const song=recognition.find(data);if(!song)break;recognition.cancel();if(song.source==='local' && !records.has(song.id)){toastMessage(tr("Original local file is missing. Reimport it to play"));break;}if(!records.has(song.id))remote.set(song.id,song);dialog='';await play(song.id,'recognition',[song.id]);break;}
    case 'recognition-search': {const song=recognition.find(data);if(!song)break;recognition.cancel();dialog='';query=`${song.title} ${song.artist}`.slice(0,200);navigation.update({page:'search',player:false,queueOpen:false,videoOpen:false});searchKind='songs';source='all';collapsed.clear();clearTimeout(searchTimer);searchSections=[];await loadSections('search');break;}
    case 'audio-open': dialog='audio-settings';emit();break;
    case 'audio-devices': dialog='audio-devices';emit();await sound.output.refresh();break;
    case 'audio-device-request': await sound.output.request();break;
    case 'audio-device-select': await sound.output.select(data);break;
    case 'audio-setting': preferences.audioEffects=soundPatch(preferences.audioEffects,input);persist();await sound.configure(preferences.audioEffects);emit();break;
    case 'guide-seen': if(/^[a-z-]{1,50}$/.test(data)){preferences.guideSeen=[...new Set([...(preferences.guideSeen || []),data])].slice(-80);emit();persist();}break;
    case 'guide-reset': preferences.guideSeen=[];preferences.guideEnabled=true;dialog='';emit();persist();toastMessage(tr("Guides reset. They will appear when you open each page"));break;
    case 'setting': {let value=input.value;const key=input.key;if(key==='language'){if(!['en','zh-CN'].includes(value))break;preferences.language=value;applyLanguage();emit();await persist(true);break;}if(['autoOpen','reduceMotion','recordListening','guideEnabled'].includes(key))value=value==='true';if(key==='theme' && !['system','light','dark'].includes(value))break;if(key==='searchPreference' && !sources.includes(value))break;if(key==='font' && !['sans','serif','wenkai','nunito'].includes(value))break;if(key==='font'){const revision=++fontRevision;toastMessage(tr("Preparing font…"));await loadOptionalFont(value);if(dialog!=='font' || revision!==fontRevision)break;}if(key==='motionPreset' && !['fast','slow'].includes(value))break;if(key==='lyricsSize')value=Math.max(18,Math.min(40,Number(value)||26));if(['font','motionPreset','lyricsSize','guideEnabled','autoOpen','reduceMotion','recordListening','theme','searchPreference'].includes(key))preferences[key]=value;if(key==='recordListening'){listening?.setEnabled(value,track(engine.currentId()));playback?.listeningSample(true);}emit();persist();break;}
    case 'volume': preferences.volume=Math.max(0,Math.min(100,Number(data)*100));sound.setVolume(preferences.volume/100);emit();persist();break;
    case 'playlist-open': if(data)navigation.update({page:'library',tab:'playlists',playlistId:data,libraryGroup:'',libraryQuery:'',libraryPage:0});else navigation.close('playlistId');break;
    case 'playlist-play': {const p=decode(engine.playlistJson(data));if(p?.trackIds.length)await play(p.trackIds[0],'playlist:'+data,p.trackIds);break;}
    case 'playlist-menu': target=data;dialog='playlist-menu';emit();break;
    case 'playlist-rename-open': dialog='playlist-rename';dialogText=decode(engine.playlistJson(target))?.name || '';emit();break;
    case 'playlist-delete-open': dialog='playlist-delete';emit();break;
    case 'playlist-delete': if(dialog==='playlist-delete' && data===target){await playlistEditor.run(data,()=>null);if(dialog==='playlist-delete' && target===data)dialog='';if(playlistId===data)navigation.update({playlistId:''},{replace:true});emit();}break;
    case 'playlist-edit': target=data || target;dialog='playlist-edit';emit();break;
    case 'playlist-save': if(dialog==='playlist-edit' && input?.id===target){const owner=target;await playlistEditor.patch(owner,{name:input.name,description:input.description,tags:String(input.tags || '').split(/[,，\n]/),background:input.background,backgroundTrackId:input.backgroundTrackId,backgroundOpacity:Number(input.backgroundOpacity)});if(dialog==='playlist-edit' && target===owner)dialog='';emit();}break;
    case 'playlist-background-file': if(target)chooseFiles('playlist-art:'+target,'image/png,image/jpeg,image/webp');break;
    case 'playlist-create-add-open': if(dialog==='playlist-add'){pendingPlaylistTracks=menuContext==='bulk'?dialogText.split('\n').filter(id=>records.has(id)):[target];dialogText='';playlistCreateId='playlist-'+crypto.randomUUID();dialog='playlist-create-add';emit();}break;
    case 'playlist-add': {const owner=target;const ids=menuContext==='bulk'?dialogText.split('\n').filter(id=>records.has(id)):[target];for(const id of ids)await ensureSaved(id);await playlistEditor.membership(data,ids);if(dialog==='playlist-add' && target===owner)dialog='';emit();toastMessage(tr("Added to playlist"));break;}
    case 'playlist-remove-song': {const id=menuContext.slice(9);await playlistEditor.membership(id,[target],true);dialog='';emit();toastMessage(tr("Removed from playlist"));break;}
    case 'dialog-save': {const savingDialog=dialog,savingTarget=target;
      if(['playlist-create','playlist-create-add','playlist-rename'].includes(dialog)) {const id=dialog==='playlist-rename'?target:(playlistCreateId ||= 'playlist-'+crypto.randomUUID());if(dialog!=='playlist-rename' && playlistMetadata.size>=200)throw new Error(tr("Maximum number of playlists: 200 playlists"));const initial=dialog==='playlist-create-add'?[...pendingPlaylistTracks]:[];for(const trackId of initial)await ensureSaved(trackId);await playlistEditor.run(id,old=>({...old,id,name:data,trackIds:old?.trackIds || initial,createdAt:old?.createdAt || Date.now()}));pendingPlaylistTracks=[];}
      else if(dialog==='lyrics-edit')await saveLyrics(target,data,true,'local');
      else if(dialog==='metadata') {const [title,artist,album]=data.split('\n');if(!title?.trim())throw new Error(tr("Track title cannot be empty"));const record=await ensureSaved(target);const patch={title:title.trim().slice(0,2000),artist:(artist?.trim() || tr("Unknown artist")).slice(0,2000),album:(album?.trim() || '').slice(0,2000),creatorId:(artist?.trim() || tr("Unknown artist"))===record.artist?record.creatorId:''};await store.patchTrack(target,patch);Object.assign(record,patch);engine.upsertMetadata(target,record.title,record.artist,record.durationMs,record.favorite)}
      else if(dialog==='live-link') {dialog='';await dispatch('live-open',data);emit();return;}
      else if(dialog==='account-connect') {await changeAccount(target,data);return;}
      ++libraryRevision;++playlistRevision;if(dialog===savingDialog && target===savingTarget)dialog='';emit();break;
    }
    case 'accounts-open': openAccounts();await loadAccountStates();break;
    case 'accounts-select': if(sources.includes(data))openAccounts(data);break;
    case 'settings-local': dialog='settings-local';emit();break;
    case 'settings-import': if(dialog==='settings-local' && ['files','folder'].includes(data)){dialog='';emit();chooseFiles('music',data==='folder'?'':'audio/*,.mp3,.flac,.m4a,.wav,.ogg,.lrc',true,data==='folder');}break;
    case 'account-start': if(sources.includes(data) && !accountChanging && !accountChecking && !accountReader.state.loading){openAccounts(data);target=data;dialog='account-qr';dialogText='';emit();accountSession.start(data);}break;
    case 'account-refresh': if(dialog==='account-qr')accountSession.start(target);break;
    case 'account-back': accountSession.close();dialog='';emit();await loadAccountStates();break;
    case 'account-check': await checkAccount(data);break;
    case 'accounts-refresh': if(!accountChanging && !accountChecking)await loadAccountStates();break;
    case 'account-open': if(sources.includes(data) && !accountChanging && !accountChecking){openAccounts(data);target=data;dialog='account-connect';dialogText='';emit();}break;
    case 'account-disconnect-open': if(sources.includes(data) && !accountChanging && !accountChecking){target=data;dialog='account-disconnect';emit();}break;
    case 'account-clear': if(dialog==='account-disconnect' && data===target)await changeAccount(data,'');break;
    case 'remove': {
      await mediaCache?.cancel(data);const current=engine.currentId()===data;const playing=playback.desiredPlaying;queueMetadata.select(decode(engine.queueIdsJson()).filter(id=>id!==data));await savingTracks.get(data)?.catch(()=>{});await store.remove(data);records.delete(data);remote.delete(data);engine.removeTrack(data);for(const [id,p] of playlistMetadata)if(p.backgroundTrackId===data)playlistMetadata.set(id,{...p,background:'none',backgroundTrackId:''});++playlistRevision;invalidateCover(data);
      ++libraryRevision;++queueRevision;
      if(current){if(engine.currentId())playback.switchTo(engine.currentId(),{play:playing});else{playback.stop();navigation.update({player:false},{replace:true})}}
      dialog='';emit();persist();toastMessage(tr("Removed from library"));break;
    }
    case 'retry-play': error='';playback.retry();emit();break;
    case 'cache': await cacheSong(data);break;
    case 'storage-info': await updateStorage();await mediaCache.refresh();break;
    case 'cache-open': navigation.update({page:'cache',player:false,queueOpen:false,videoOpen:false});break;
    case 'cache-filter': if(['all','download','automatic'].includes(data))navigation.update({cacheFilter:data,cachePage:0},{replace:true});break;
    case 'cache-page': navigation.update({cachePage:Math.max(0,Math.min(Math.max(0,Math.ceil(cacheRows().length/CACHE_LIMITS.pageSize)-1),Number(data)||0))},{replace:true});break;
    case 'cache-refresh': await mediaCache.refresh();break;
    case 'cache-cancel': await mediaCache.cancel(data);break;
    case 'cache-cancel-all': await mediaCache.cancelAll();toastMessage(tr("Current download queue cancelled"));break;
    case 'cache-retry-failed': for(const job of mediaCache.tasks.filter(row=>row.status==='error').slice(0,20))cacheSong(job.id);break;
    case 'cache-retry': cacheSong(data);break;
    case 'cache-limit': {const value=Number(data);if(!CACHE_BUDGETS.includes(value))break;if(mediaCache.info.cleaning)throw new Error(tr("Cleanup is running. Adjust capacity later"));dialog='';preferences.cacheLimitMb=value;if(value===0)preferences.autoCache=false;mediaCache.resetAutomatic();emit();persist();await mediaCache.maintain();break;}
    case 'cache-auto': {if(data==='true' && preferences.cacheLimitMb===0)throw new Error(tr("Set an automatic cache limit first"));preferences.autoCache=data==='true';mediaCache.resetAutomatic();mediaCache.playback(engine.currentId(),playback.status==='playing');emit();persist();break;}
    case 'cache-keep-favorites': preferences.cacheKeepFavorites=data==='true';emit();persist();await mediaCache.maintain();break;
    case 'cache-pressure-ack': mediaCache.acknowledge(data);break;
    case 'cache-clean-open': target=data || 'automatic';dialog='cache-clean';emit();break;
    case 'cache-clean-confirm': {if(dialog!=='cache-clean' || target!==data)break;const owner=dialogFeedback.revision;const result=await mediaCache.clean(data==='automatic'?'':data);if(dialog==='cache-clean' && target===data && dialogFeedback.revision===owner)dialog='';emit();toastMessage(result.blocked?tr("Available cache cleared. Current, next, and retained tracks are protected"):tr("Freed {0} MB，Lyrics and artwork are kept", (result.freedBytes/1048576).toFixed(1)));break;}
    case 'cache-catalog-clean': await store.clearCatalog();toastMessage(tr("Search and recommendation cache cleared"));break;
    case 'backup-export': await exportBackup();break;
    case 'backup-import': chooseFiles('backup','.tinglan,application/x-tinglan-backup');break;
    case 'backup-restore': await restoreBackup();break;
    case 'cancel-backup': ++backupRevision;backups.close();busy=false;pendingBackup=null;dialog='';message='';emit();break;
    case 'licenses': {const response=await fetch('./THIRD_PARTY_NOTICES.txt');download(new Blob([await response.text()],{type:'text/plain'}),tr("Tinglan-Open-source licenses.txt"));break;}
  }
}
function loadBiliContext(force=false){const current=track(engine?.currentId()),id=current?.source==='bili'?parseBilibiliId(current.remoteId):null;if(id)biliPages?.select({id:'bili-'+id.bvid},{force});else{biliPages?.cancel();biliState=null;++biliRevision;}}
function openVideo(){const id=engine.currentId();if(!video || track(id)?.source!=='bili')return;video.open(id,{quality:preferences.biliQuality,origin:coverOrigin,reduced:preferences.reduceMotion || reducedQuery.matches});danmakuSession.select(id,preferences.danmakuEnabled);}
function openLive(resetBounds=true){if(!live)return;if(resetBounds)liveHost.open();live.open(liveRoomId,preferences.liveQuality || 80);}
function liveChanged(state) {
  if(live?.active && navigator.mediaSession){navigator.mediaSession.playbackState=state.status==='playing'?'playing':'paused';
    const key=state.room?.roomId+'|'+state.room?.title;if(state.room && key!==lastLiveMetadata && globalThis.MediaMetadata){lastLiveMetadata=key;navigator.mediaSession.metadata=new MediaMetadata({title:state.room.title,artist:state.room.creatorName,album:tr("Tinglan · Bilibili Live")});try{navigator.mediaSession.setPositionState?.();}catch{}}
  }else lastLiveMetadata='';emit();
}
function presenceSnapshot() {
  const status=presencePages?.forRoute({page,creatorSource,creatorId});
  if(!status)return {presenceInfo:null,liveCreators:empty,presenceAnimating:false};
  return {presenceInfo:{...status,scope:status.request?.scope || '',id:status.request?.id || '',items:undefined,request:undefined},liveCreators:status.request?.scope==='following'?cachedData('live-creators',String(presenceRevision),()=>status.items.map(row=>({...row,avatar:undefined,avatarKey:row.avatar?.key || ''}))):empty,presenceAnimating:!document.hidden && !player && !queueOpen && !dialog && !!status.request};
}
function selectPresence(force=false) {
  if(document.hidden || player || queueOpen){presencePages?.cancel();return;}
  presencePages?.select(presenceRoute({page,creatorSource,creatorId}),{force});
}
function selectActivityRoute(force=false,{presence=true}={}) {
  if(presence)selectPresence(force);
  if(page==='creator' && creatorSource==='bili' && creatorTab==='dynamics')feedPages?.select({scope:'author',id:creatorId},{force});
  else if(page==='following' && followingTab==='dynamics')feedPages?.select({scope:'following',id:''},{force});else feedPages?.cancel();
  if(page==='following' && followingTab==='creators')followingPages?.select({scope:'followings'},{force});else followingPages?.cancel();
  if(page==='dynamic')dynamicPages?.select({id:dynamicId},{force});else dynamicPages?.cancel();
}
function notesRequest(){return {query:notesQuery,category:notesCategory,page:notesPage};}
function findRadio(id){return radio?.state.station?.uuid===id?radio.state.station:radio?.state.queue.find(row=>row.uuid===id) || radioPages?.state.items.find(row=>row.uuid===id) || radios.value.stations.find(row=>row.uuid===id);}
function radioVisual(row) {
  if(!row.uuid)return {id:row.id,name:row.name,description:row.category,category:row.category,coverKey:row.image?.key || '',favorite:false};
  let country=row.countryCode;try{if(/^[A-Za-z]{2}$/.test(country))country=new Intl.DisplayNames(['en-US'],{type:'region'}).of(country.toUpperCase());}catch{}
  return {id:row.uuid,name:row.name,description:[row.region || country,row.codec==='UNKNOWN'?'':row.codec,row.bitrate>=8?row.bitrate+' kbps':''].filter(Boolean).join(' · '),coverKey:row.artworkUrl?'radio-art-'+row.uuid:'',favorite:radios.value.favorites.includes(row.uuid),custom:row.custom};
}
function radioSnapshot() {
  const state=radioPages?.state,playing=radio?.state;
  return {radioPage:{scope:radioScope,query:radioQuery,loading:state?.loading || !!radioTimer,loadingMore:state?.loadingMore || false,more:state?.nextOffset!=null,error:state?.error || radioStorageError,loadingRadioId:state?.loadingRadioId || ''},radioItems:page==='radio' && state?cachedData('radio-items',`${radioRevision}|${radioLibraryRevision}`,()=>state.items.map(radioVisual)):empty,
    radioInfo:playing?{active:playing.active,status:playing.status,station:playing.station?radioVisual(playing.station):null,error:playing.error}:null,radioQueue:playing?.active?cachedData('radio-queue',`${radioRevision}|${radioLibraryRevision}`,()=>playing.queue.map(radioVisual)):empty};
}
async function loadRadioPage(request,offset,{force=false,signal}={}) {
  const generation=platform.generation,key=request.scope==='qq'?`qq-radios|${platform.accountRevision}`:`radio-directory|${request.scope}|${request.query.trim().toLowerCase()}|${offset}`;
  const cached=await store.read('catalog',key).catch(()=>null);signal?.throwIfAborted();
  if(cached && !force)return cached;
  try{const value=await platform.request(request.scope==='qq'?'/api/qq-radios':'/api/radio-directory?'+new URLSearchParams({scope:request.scope,q:request.query,offset,force:force?'1':'0'}),{signal,timeoutMs:30000});signal?.throwIfAborted();if(request.scope==='qq' && generation!==platform.generation)throw new DOMException('Account changed','AbortError');if(request.scope!=='qq')await radios.remember(value.stations);signal?.throwIfAborted();await store.cacheCatalog(key,value).catch(()=>{});return value;}catch(error){signal?.throwIfAborted();if(request.scope==='qq' && generation!==platform.generation)throw new DOMException('Account changed','AbortError');if(cached)return {...cached,warning:tr("Connection lost. Showing previously saved stations")};throw error;}
}
function selectRadio(force=false,debounce=false) {
  clearTimeout(radioTimer);radioTimer=null;
  if(page!=='radio' || player || queueOpen || document.hidden){radioPages?.cancel();return;}
  if(debounce){radioPages?.cancel();radioTimer=setTimeout(()=>{radioTimer=null;selectRadio(force);},300);return;}
  radioPages?.select({scope:radioScope,query:radioQuery},{force});
}
async function sendRadioCover(key) {
  if(coversPending.has(key) || Date.now()-(coverFailures.get(key) || 0)<60000)return;const station=findRadio(key.slice(10));if(!station?.artworkUrl)return;coversPending.add(key);let url;
  try{const result=await platform.request('/api/radio-image',{method:'POST',body:{station}});url=result.url;if(!/^\/api\/radio-media\/[a-f0-9]{48}\/[a-f0-9]{40}$/.test(url || ''))throw new Error('Invalid artwork');const response=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Artwork unavailable');const raw=await response.blob();if(raw.size>LIMITS.artwork)throw new Error('Artwork too large');const pair=await resizeArtwork(raw),bytes=new Uint8Array(await pair[0].arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=4096)binary+=String.fromCharCode(...bytes.subarray(i,i+4096));ui.deliverArtwork(key,btoa(binary));}catch{coverFailures.set(key,Date.now());while(coverFailures.size>160)coverFailures.delete(coverFailures.keys().next().value);}finally{coversPending.delete(key);if(url)platform.request('/api/radio-revoke',{method:'POST',body:{path:url}}).catch(()=>{});}
}
function selectStatistics(force=false) {
  if(page!=='statistics' || document.hidden || player || queueOpen){statisticsPages?.cancel();return;}
  statisticsPages?.select({period:statsPeriod,offset:statsOffset},{force});
}
function statisticsChanged(kind='changed') {statisticsPages?.invalidate();selectStatistics();try{statisticsChannel?.postMessage({kind});}catch{}emit();}
function connectStatistics() {
  const previous=listeningStore.epoch;
  listeningStore.open().then(()=>{if(previous && previous!==listeningStore.epoch){listening?.reset();listening?.begin(track(engine?.currentId()));playback?.listeningSample(true);statisticsPages?.invalidate();selectStatistics();}}).catch(()=>{});
  if(statisticsChannel || !globalThis.BroadcastChannel)return;
  try{statisticsChannel=new BroadcastChannel('tinglan-listening-changes');statisticsChannel.onmessage=async event=>{if(!['changed','reset'].includes(event.data?.kind))return;if(event.data.kind==='reset'){listening?.reset();await listeningStore.open().catch(()=>{});listening?.begin(track(engine?.currentId()));playback?.listeningSample(true);}statisticsPages?.invalidate();selectStatistics();emit();};}catch{/* Manual report refresh remains available. */}
}
function notesSnapshot() {
  const info=page==='notes'?notePages?.forRequest(notesRequest()):null;
  return {notesInfo:info?{...info,items:undefined,categories:undefined,request:undefined,query:notesQuery,category:notesCategory,loading:info.loading || notesDebouncing}:null,noteItems:info?cachedData('notes',`${JSON.stringify(notesRequest())}|${notesRevision}|${libraryRevision}`,()=>info.items.map(row=>{const song=track(row.songId);return {...notePreview(row),source:song?.source || 'local',hasArtwork:!!(song?.hasArtwork || song?.artworkUrl),dateLabel:new Date(row.updatedAt).toLocaleDateString(currentLanguage())};})):empty,noteCategories:info?.categories.length?info.categories:empty};
}
function selectNotesRoute({force=false,debounce=false}={}) {
  clearTimeout(notesTimer);notesDebouncing=false;
  if(page!=='notes' || document.hidden || player || queueOpen){notePages?.cancel();return;}
  if(debounce){notePages?.cancel();notesDebouncing=true;notesTimer=setTimeout(()=>selectNotesRoute(),300);return;}
  notePages?.select(notesRequest(),{force});
}
async function refreshNotes({broadcast=false}={}) {
  notePages?.invalidate();if(broadcast)noteUpdates?.notify();selectNotesRoute({force:true});const revision=++noteCountRead;
  try{const count=await noteStore.count();if(revision===noteCountRead){noteCount=count;emit();}}catch{/* Accepted notes remain readable when storage is temporarily unavailable. */}
}
function connectNoteUpdates() {
  if(!noteUpdates)noteUpdates=new NoteChanges(()=>refreshNotes());noteUpdates.open();
}
globalThis.tinglanDispatch=(action,data)=>{
  if(['play','play-group','toggle','next','previous','retry-play','bili-context-play','live-open','live-toggle','radio-play','radio-toggle','radio-next','radio-previous','radio-queue-play','radio-qq-play'].includes(action))sound?.gesture();
  if(action==='modal-state') {try{const state=JSON.parse(data);modalSemantics.set(state.root,state.active==='true');}catch{/* Ignore malformed internal semantics messages. */}return;}
  dialogFeedback.sync(dialog,target);const ticket=dialogFeedback.begin(!['cover','artwork-origin','video-viewport','live-viewport'].includes(action));emit();
  Promise.resolve(dispatch(action,data)).catch(failure=>{
    console.warn('Interaction failed',action,failure.name,String(failure.stack || '').split('\n').slice(1,5).join('\n'));
    dialogFeedback.sync(dialog,target);const feedback=dialogFeedback.report(ticket,failure.message);
    if(feedback==='toast')toastMessage(failure.message || tr("Action incomplete. Retry"));else if(feedback==='dialog'){toast='';clearTimeout(toastTimer);}
    if(feedback!=='obsolete' && dialog==='backup-progress'){busy=false;dialog='';}emit();
  });
};
navigator.connection?.addEventListener?.('change',()=>mediaCache?.playback(engine?.currentId(),playback?.status==='playing'));
document.addEventListener('visibilitychange',()=>{if(document.hidden){recognition?.cancel();localIndexManager?.cancel();}mediaCache?.playback(engine?.currentId(),!document.hidden && playback?.status==='playing');if(!document.hidden)radios.load().catch(()=>{});selectRadio();playback?.listeningSample();listening?.flush().catch(()=>{});if(!document.hidden)connectStatistics();selectStatistics();syncClock();video?.sync(true);live?.visibility();accountSession?.visibility();selectPresence();selectNotesRoute();if(document.hidden)lan?.stop({leave:true});else if(page==='transfer' && !player && !queueOpen)lan?.open();emit();});darkQuery.addEventListener('change',emit);reducedQuery.addEventListener('change',emit);
window.addEventListener('pagehide',event=>{recognition?.cancel();localIndexManager?.cancel();localMatcher?.close();mediaCache?.leave().catch(()=>{});radio?.pause();radioPages?.cancel();radioPages?.cancelSelection();clearTimeout(radioTimer);playback?.listeningSample();listening?.flush().catch(()=>{});statisticsPages?.cancel();statisticsChannel?.close();statisticsChannel=null;notePages?.cancel();noteEditor?.close();clearTimeout(notesTimer);noteUpdates?.close();noteUpdates=null;presencePages?.cancel();lan?.stop({leave:true});metadata.close();backups.close();live?.pause();accountSession?.close();clearTimeout(clockTimer);clearTimeout(prefsTimer);if(engine)store.saveSettings(snapshotPreferences()).catch(()=>{});if(!event.persisted){localIndexManager?.dispose();sound?.dispose();for(const url of coversUrls.values())URL.revokeObjectURL(url);coversUrls.clear()}});
window.addEventListener('pageshow',()=>{selectRadio();playback?.listeningSample(true);connectStatistics();selectStatistics();syncClock();video?.sync(true);live?.visibility();accountSession?.visibility();selectPresence();connectNoteUpdates();selectNotesRoute();});

async function start() {
  const [coreModule,uiModule]=await Promise.all([import('./engine/tinglan-web-core.mjs'),import('./ui/tinglan-web-ui.mjs')]);engine=coreModule.engineVersion?coreModule:coreModule.default;ui=uiModule.updateUi?uiModule:uiModule.default;
  updates=new ApplicationUpdates(navigator.serviceWorker,{changed:(available,state)=>{updateAvailable=available;updatePrompt=state?.prompt===true;updateApplying=state?.applying===true;if(state?.error)toastMessage(state.error);else emit()},reload:()=>location.reload()});updates.start().catch(()=>{});setTimeout(()=>{if(!document.hidden)webIntegration.suggest();},12000);
  await store.open();await listeningStore.open();await hydrate();await radios.load().catch(e=>{radioStorageError=e.message;});page=['home','search','library','settings','notes','statistics','radio','cache','accounts'].includes(location.hash.slice(1))?location.hash.slice(1):'home';
  navigation=new RouteHistory(window,{page,tab,playlistId,libraryGroup,libraryQuery,libraryPage,player,queueOpen,videoOpen},route=>{
    const wasVideo=videoOpen,previousRadioQuery=radioQuery,previousPage=page,previousNotesQuery=notesQuery,previousLive=liveRoomId,previousCreator=`${creatorSource}|${creatorId}|${creatorPage}|${creatorTab}`,previousComment=`${commentId}|${commentRoot}|${commentOrder}|${commentCursor}`,previousCollection=`${collectionSource}|${collectionId}|${collectionPage}`,previousActivity=`${page}|${creatorSource}|${creatorId}|${creatorTab}|${dynamicId}|${followingTab}`;
    ({page,accountSource,tab,playlistId,libraryGroup,libraryQuery,libraryPage,player,queueOpen,videoOpen,creatorId,creatorSource,creatorPage,creatorTab,dynamicId,followingTab,commentId,commentRoot,commentOrder,commentCursor,collectionSource,collectionId,collectionPage,liveRoomId,notesQuery,notesCategory,notesPage,statsPeriod,statsOffset,radioScope,radioQuery,cacheFilter,cachePage}=route);
    if(gallery.state.open)gallery.close();
    if(page!=='search'){clearTimeout(searchTimer);++searchRevision;for(const id of sources)platform.cancel('search:'+id);}
    if(page!=='library')clearTimeout(libraryQueryTimer);
    if(previousPage==='radio' && page!=='radio')radioPages?.cancelSelection();selectRadio(false,previousPage==='radio' && page==='radio' && previousRadioQuery!==radioQuery);
    recognition?.cancel();if(!player)videoOpen=false;accountSession?.close();dialog='';++radioAddVersion;radioAdding=false;radioAddError='';if(noteEditor?.state.token)noteEditor.close();
    if(page==='webdav')webdav?.open();else webdav?.close();
    if(page==='cache' && previousPage!=='cache')mediaCache?.refresh();
    if(page==='transfer' && !player && !queueOpen && !document.hidden){if(!lan?.visible)lan?.open();}else if(lan?.visible)lan.stop({leave:true});
    if(page==='live' && (previousPage!=='live' || previousLive!==liveRoomId))openLive();else if(page!=='live' && previousPage==='live'){liveHost?.close();live?.close().catch(e=>toastMessage(e.message));}
    if(videoOpen && !wasVideo)openVideo();else if(!videoOpen && wasVideo){video?.close(coverOrigin);danmakuSession?.select('',false);}
    if(page==='creator' && (previousPage!==page || previousCreator!==`${creatorSource}|${creatorId}|${creatorPage}|${creatorTab}`))creatorPages?.select(creatorSource,creatorId,creatorPage,{profileOnly:creatorSource==='bili' && creatorTab==='dynamics'});else if(page!=='creator')creatorPages?.cancel();
    if(previousActivity!==`${page}|${creatorSource}|${creatorId}|${creatorTab}|${dynamicId}|${followingTab}`)selectActivityRoute();
    selectPresence();
    selectNotesRoute({debounce:previousPage==='notes' && page==='notes' && previousNotesQuery!==notesQuery});selectStatistics();
    if(page==='comments' && (previousPage!==page || previousComment!==`${commentId}|${commentRoot}|${commentOrder}|${commentCursor}`))commentPages?.select({id:commentId,root:commentRoot,order:commentOrder,cursor:commentCursor});else if(page!=='comments')commentPages?.cancel();
    if(page==='collection' && (previousPage!==page || previousCollection!==`${collectionSource}|${collectionId}|${collectionPage}`))collectionPages?.select({source:collectionSource,id:collectionId,page:collectionPage});else if(page!=='collection')collectionPages?.cancel();emit();syncClock();
  });
  const mediaStore={read:(...args)=>store.read(...args),diagnose:(url,signal)=>platform.mediaState(url,signal),sourceFor:async(id,signal)=>{const local=await store.read('media',id);if(local instanceof Blob){mediaCache?.touch(id);return local;}const value=track(id);if(value?.source && value.source!=='local'){if(value.cached)await mediaCache?.missing(id);signal?.throwIfAborted();return platform.source(id,signal);}return local}};
  statisticsPages=new ListeningPages(listeningStore,statisticsWorker,emit);
  listening=new ListeningRecorder(row=>listeningStore.save(row),{changed:()=>{statsWarning='';statisticsChanged();},error:error=>{statsWarning=error.message || tr("Listening statistics were not saved");emit();}});
  listening.enabled=preferences.recordListening!==false;connectStatistics();
  playback=new BrowserPlayback(engine,mediaStore,{
    listening:(sample,options)=>{if(sample.active && !listening.current)listening.begin(track(sample.id));listening.observe(sample,options)},listeningBegin:value=>listening.begin(value),listeningEnd:()=>listening.finish(),listeningFlush:()=>listening.flush().catch(()=>{}),
    intent:()=>{++mediaEpoch;},
    metadata:id=>track(id),
    notice:()=>emit(),recovered:()=>{if(error){error='';emit();}},
    track:id=>{preferences.recentTrackIds=[id,...(preferences.recentTrackIds || []).filter(value=>value!==id)].slice(0,100);++mediaEpoch;lastLyricsId='';error='';loadBiliContext();if(videoOpen){if(track(id)?.source==='bili')openVideo();else navigation.update({videoOpen:false},{replace:true})}emit();fetchLyrics(id);persist();sendCover(id+':full')},state:()=>{mediaCache?.playback(engine.currentId(),playback?.status==='playing');emit();syncClock()},time:()=>syncClock(),
    duration:(id,ms)=>{const value=track(id);if(value && Math.abs(value.durationMs-ms)>500){value.durationMs=Math.round(ms);++libraryRevision;engine.upsertMetadata(id,value.title,value.artist,ms,value.favorite);if(records.has(id))store.patchTrack(id,{durationMs:value.durationMs}).catch(()=>{});emit()}},
    error:text=>{error=text;emit();toastMessage(text)},
  });
  mediaCache=new MediaCache({store,record:track,ensure:ensureSaved,source:(id,signal)=>platform.cacheSource(id,signal),revoke:path=>platform.request('/api/cache-revoke',{method:'POST',body:{path},timeoutMs:3000}),lyrics:(id,signal,row)=>platform.lyrics(id,signal,'platform',row),resize:resizeArtwork,preferences:()=>preferences,protectedIds:cacheProtected,
    estimate:()=>navigator.storage?.estimate?.() || Promise.resolve({}),visible:()=>!document.hidden && !busy && !accountChanging,networkAllowed:()=>!navigator.connection?.saveData && !['slow-2g','2g'].includes(navigator.connection?.effectiveType),
    artwork:async(id,signal)=>{const response=await fetch('/api/artwork?id='+encodeURIComponent(id),{signal,credentials:'same-origin'});if(!response.ok)throw new Error(tr("No artwork available"));return response.blob();},
    committed:applyCacheUpdates,changed:()=>{++cacheTasksRevision;emit();}});
  mediaCache.maintain().catch(()=>{});mediaCache.startBackground(navigator.serviceWorker,()=>webIntegration.view().notifyEnabled).catch(()=>{});
  navigator.serviceWorker?.addEventListener('message',event=>{if(event.data?.type==='tinglan-notification-route' && event.data.route==='#cache')navigation.update({page:'cache',player:false,queueOpen:false});});
  const radioAudio=document.createElement('audio');radioAudio.id='tinglan-radio-audio';radioAudio.preload='none';radioAudio.setAttribute('aria-hidden','true');document.body.append(radioAudio);
  radio=new RadioPlayback({audio:radioAudio,music:playback,source:async(station,signal,{count})=>{const value=await platform.request('/api/radio-source',{method:'POST',body:{station,countListen:count},signal});try{if(value.hls)hlsModule ||=await import('./hls-adapter.mjs');const response=await fetch(value.url,{method:'HEAD',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});if(!response.ok)throw new Error(response.status===401?tr("Station access denied. Choose another station"):tr("Station is temporarily unreachable"));return value;}catch(error){platform.request('/api/radio-revoke',{method:'POST',body:{path:value.url}}).catch(()=>{});throw error;}},attachHls:(...args)=>hlsModule.attachLiveHls(...args),revoke:path=>platform.request('/api/radio-revoke',{method:'POST',body:{path}}),recent:station=>radios.remember([station],{recent:station.uuid}),changed:state=>{++radioRevision;if(ready)persist();if(state.active && !live?.active && navigator.mediaSession){navigator.mediaSession.playbackState=state.status==='playing'?'playing':'paused';radio?.metadata();}emit();}});
  radioPages=new RadioPages({library:radios,load:loadRadioPage,loadTracks:(id,{signal})=>platform.request('/api/qq-radio-tracks?'+new URLSearchParams({id}),{signal}),changed:state=>{++radioRevision;registerImages(state);emit();},selected:async(id,songs,guard)=>{if(!guard())return;for(const song of songs)if(!records.has(song.id))remote.set(song.id,song);await play(songs[0].id,'qq-radio:'+id,songs.map(row=>row.id),{guard});}});
  const liveMusic={get audio(){return radio.active?radio.audio:playback.audio;},suspend:()=>radio.active?{kind:'radio',token:radio.suspend()}:{kind:'music',token:playback.suspend()},resume:(owner,options)=>owner?.kind==='radio'?radio.resume(owner.token,options):playback.resume(owner?.token,options)};
  videoHost=createVideoHost(()=>ui.mountVideoControls(),fullscreen=>video?.patch({fullscreen}));
  liveHost=createLiveHost(()=>ui.mountLiveControls(),fullscreen=>live?.patch({fullscreen}));
  live=new LivePlayback({video:liveHost.video,music:liveMusic,loadRoom:(id,signal)=>platform.request(`/api/live-room?room=${id}`,{signal}),
    loadSource:async(id,quality,signal)=>{hlsModule ||= await import('./hls-adapter.mjs');signal.throwIfAborted();return platform.request(`/api/live-stream?${new URLSearchParams({room:id,quality})}`,{signal});},
    supported:stream=>hlsModule?.supportsLiveStream(stream) || false,attach:(...args)=>hlsModule.attachLiveHls(...args),revoke:path=>platform.request(`/api/live-revoke?path=${encodeURIComponent(path)}`),changed:liveChanged,hidden:()=>document.hidden});
  sound=new BrowserSound([playback.audio,radioAudio,liveHost.video],preferences.audioEffects,{changed:emit});
  const pauseForAnalysis=()=>{++mediaEpoch;radioPages?.cancelSelection();playback.pause();radio?.pause();live?.pause();};
  const localIndexStore=new LocalIndexStore(store);localMatcher=new LocalIndexMatcher(localIndexStore);localIndexManager=new LocalIndexManager(localIndexStore,{changed:emit,canBuild:()=>!recognition?.busy,decoder:new LocalIndexDecoder({beforeCapture:pauseForAnalysis})});
  recognition=new MusicRecognition({capture:new BrowserRecognitionCapture(),fingerprint:new BrowserFingerprint(),history:new RecognitionHistory(store),mode:preferences.recognitionMode,localMatch:(pcm,options)=>localMatcher.match(pcm,options),match:(fingerprint,signal)=>platform.request('/api/recognition',{method:'POST',body:{fingerprint,duration:6},signal}),changed:emit,prepare:()=>{localIndexManager.cancel(tr("Recognition started. Indexing paused"));pauseForAnalysis();},remember:song=>{if(song.source!=='local' && !records.has(song.id))remote.set(song.id,song);}});
  const beforePlay=element=>{recognition?.cancel();localIndexManager?.playbackIntent();return sound.prepare(element);};playback.beforePlay=beforePlay;radio.beforePlay=beforePlay;live.beforePlay=beforePlay;
  playback.mediaDelegate=(action)=>{
    sound.gesture();if(!live.active && radio.active){if(action==='play')radio.play();else if(action==='pause')radio.pause();else if(action==='nexttrack' || action==='previoustrack')radio.change(action==='nexttrack'?1:-1);return true;}if(!live.active)return false;if(action==='play')live.play();else if(action==='pause')live.pause();else if(action==='nexttrack' || action==='previoustrack')globalThis.tinglanDispatch(action==='nexttrack'?'next':'previous','');return true;};
  video=new VideoPlayback({audio:playback.audio,host:videoHost,sourceFor:(id,quality,signal)=>platform.video(id,quality,signal),changed:emit,clock:at=>ui.updateVideoClock(at),capabilities:navigator.mediaCapabilities,hidden:()=>document.hidden});
  danmakuSession=new DanmakuSession((id,signal)=>platform.danmaku(id,signal),items=>{danmakuItems=items;emit()},text=>toastMessage(text));
  notePages=new NotePages((...args)=>noteStore.page(...args),state=>{++notesRevision;if(page==='notes' && !state.loading && state.page!==notesPage && state.request.query===notesQuery && state.request.category===notesCategory){navigation.update({notesPage:state.page},{replace:true});return;}emit();});
  noteEditor=new NoteEditor(noteStore,emit,{committed:()=>refreshNotes({broadcast:true})});connectNoteUpdates();
  presencePages=new LivePresencePages((...args)=>platform.presence(...args),state=>{++presenceRevision;registerImages(state);emit();});
  creatorPages=new CreatorPages((...args)=>platform.creator(...args),state=>{creatorState=state;++creatorRevision;for(const song of state.songs)if(!records.has(song.id))remote.set(song.id,song);trimRemote();emit()});
  commentPages=new ContentPages((...args)=>platform.comments(...args),state=>{commentState=state;++commentRevision;registerImages(state);emit();});
  collectionPages=new ContentPages((...args)=>platform.collection(...args),state=>{collectionState=state;++collectionRevision;registerImages(state);for(const song of state.songs)if(!records.has(song.id))remote.set(song.id,song);trimRemote();emit();},{limit:12});
  biliPages=new ContentPages((request,options)=>platform.biliContext(request.id,options),state=>{biliState=state;++biliRevision;for(const song of [...(state.parts || []).map(row=>row.song),...(state.collection?.songs || [])])if(!records.has(song.id))remote.set(song.id,song);trimRemote();emit();},{limit:8});
  feedPages=new ActivityFeed((...args)=>platform.activityFeed(...args),state=>{feedState=state;++feedRevision;registerImages(state);for(const row of state.items)for(const song of [row.song,row.original?.song].filter(Boolean))if(!records.has(song.id))remote.set(song.id,song);trimRemote();emit();});
  dynamicPages=new ContentPages(async(request,options)=>{const value=await platform.activityDetail(request,options);return {...value,songs:[value.activity?.song,value.activity?.original?.song].filter(Boolean)};},state=>{dynamicState=state;++dynamicRevision;registerImages(state);for(const song of state.songs)if(!records.has(song.id))remote.set(song.id,song);trimRemote();emit();},{limit:12});
  followingPages=new ActivityFeed((...args)=>platform.followings(...args),state=>{followingState=state;++followingRevision;registerImages(state);emit();},{limit:1});
  accountSession=new AccountSession({platform,encode:async url=>(await import('./login-qr.mjs')).loginQrRows(url),deliverImage:deliverLoginImage,hidden:()=>document.hidden,changed:emit,
    connected:async(source,value)=>{accountReader.accept(value);accountError='';emit();await resetPlatformContent();toastMessage(tr("{0} Session connected", names[source]));}});
  videoActions=new VideoActions({platform,changed:emit});
  deviceId=await store.read('settings','handoff-device-id').catch(()=>null);
  if(typeof deviceId!=='string' || !/^[a-f0-9-]{36}$/.test(deviceId)){deviceId=crypto.randomUUID();await store.write(['settings'],tx=>tx.objectStore('settings').put(deviceId,'handoff-device-id')).catch(()=>{});}
  webdav=new WebDavClient({platform,deviceId,changed:emit,capture:handoffOwner,outgoing:outgoingHandoff,prepare:prepareHandoff,continueHere:continueHandoff,
    published:(_snapshot,owner)=>{if(!handoffStillOwned(owner))return false;++mediaEpoch;playback.pause();persist();return true;}});
  lan=new LanTransferClient({platform,changed:emit,encode:async url=>(await import('./login-qr.mjs')).loginQrRows(url),importFile:async(file,options)=>{
    if(busy || importReservation || accountChanging)throw new Error(tr("A task is running. Retry importing on the receiver page later"));
    await importLanAudio(file,options,{records,store,parse:file=>metadata.run('metadata',file),artwork:resizeArtwork,beforeCommit:record=>{
      if(busy || importReservation || accountChanging)throw new Error(tr("A task is running. Retry importing on the receiver page later"));
      trimRemote();if(!engine.upsertMetadata(record.id,record.title,record.artist,record.durationMs,record.favorite))throw new Error(tr("Library and queue capacity is insufficient. Remove unwanted content"));return ()=>engine.removeTrack(record.id);
    },upsert:record=>{engine.upsertMetadata(record.id,record.title,record.artist,record.durationMs,record.favorite);if(record.lyrics)engine.setLyrics(record.id,record.lyrics);},changed:()=>{++libraryRevision;emit();}});
    await updateStorage();
  }});
  if(!STATIC_HOSTING)await loadAccountStates();
  sound.setVolume(preferences.volume/100);ready=true;emit();syncClock();
  loadBiliContext();selectNotesRoute();selectStatistics();selectRadio();
  document.getElementById('boot-canvas')?.remove();
  if(engine.currentId() && track(engine.currentId())?.cached)await playback.switchTo(engine.currentId(),{play:false,position:preferences.position});
  if(preferences.radioStationId){const restoredRadio=radios.value.stations.find(row=>row.uuid===preferences.radioStationId);if(restoredRadio)await radio.open(restoredRadio,{play:false,queue:radios.rows('recent'),count:false});}
  updateStorage();loadSections('home');

}
start().catch(failure=>{error=failure.message || tr("Unable to start the application");if(ui){document.getElementById('boot-canvas')?.remove();emit();}else globalThis.tinglanBootError?.(error)});

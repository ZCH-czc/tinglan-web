import {searchHistory} from './search-history.mjs';
import {parseBilibiliId} from './bilibili-id.mjs';
import {CACHE_BUDGETS,cacheTime} from './cache-policy.mjs';
import {soundSettings,SOUND_DEFAULTS} from './audio-settings.mjs';
import {libraryPreferences,playlistDetails} from './library-catalog.mjs';
export const LIMITS = Object.freeze({ tracks: 10_000, playlists: 200, audio: 512 * 1024 * 1024, artwork: 20 * 1024 * 1024, lyrics: 200_000 });
export const DEFAULTS = Object.freeze({ recognitionMode:'auto',audioEffects:SOUND_DEFAULTS,autoCache:false,cacheLimitMb:1024,cacheKeepFavorites:true,recordListening:true, theme: 'system', autoOpen: true, reduceMotion: false, volume: 80, sort: 'recent', currentId: '', position: 0, queue: [], queueIndex:-1,queueLocked:false,shuffle:false,repeat: 'OFF', searchPreference: 'qq', biliQuality:80, liveQuality:80, danmakuEnabled:false, danmakuSize:22, danmakuAlpha:.85, danmakuArea:.5, danmakuSpeed:1, danmakuDensity:16, danmakuFps:30, danmakuBlocked:'' });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value); }
function field(value, limit, fallback = '') {
  if (value == null) return fallback;
  if (typeof value !== 'string' || value.length > limit) throw new Error('Backup text exceeds supported limits');
  return value;
}
export function normalizeTrack(value) {
  if (!object(value) || !validId(value.id)) throw new Error('Invalid track identifier in backup');
  const source = ['qq','bili','netease'].includes(value.source) ? value.source : 'local';
  const cached = source === 'local' || value.cached === true;
  if (!Number.isSafeInteger(value.size) || value.size < (cached ? 1 : 0) || value.size > LIMITS.audio || (!cached && value.size !== 0)) throw new Error('Invalid audio file size in backup');
  const remoteId = source === 'local' ? '' : field(value.remoteId, 40);
  if (source !== 'local' && (value.id !== `${source}-${remoteId}` || !(source==='bili'?parseBilibiliId(remoteId):/^[A-Za-z0-9]{1,40}$/.test(remoteId)))) throw new Error('Invalid online track identifier');
  return {
    id: value.id, title: field(value.title, 2000, 'Untitled track') || 'Untitled track', artist: field(value.artist, 2000, 'Local music') || 'Local music',
    album: field(value.album, 2000), albumArtist: field(value.albumArtist, 2000), filename: field(value.filename, 2000),
    relativePath: field(value.relativePath, 4000),
    type: field(value.type, 120), size: value.size, favorite: value.favorite === true, lyrics: field(value.lyrics, LIMITS.lyrics),
    durationMs: Number.isFinite(value.durationMs) ? Math.max(0, Math.min(2_592_000_000, Math.floor(value.durationMs))) : 0,
    trackNumber: Number.isSafeInteger(value.trackNumber) && value.trackNumber >= 0 ? value.trackNumber : 0,
    year: Number.isSafeInteger(value.year) && value.year >= 0 ? value.year : 0,
    addedAt: Number.isSafeInteger(value.addedAt) && value.addedAt >= 0 ? value.addedAt : 0,
    hasArtwork: value.hasArtwork === true, source, cached, remoteId,
    cacheMode:cached && source!=='local'?(value.cacheMode==='automatic'?'automatic':'download'):'',
    cacheTouchedAt:cacheTime(value.cacheTouchedAt),cacheSavedAt:cacheTime(value.cacheSavedAt),
    originalLyrics: field(value.originalLyrics, LIMITS.lyrics), lyricsSource: field(value.lyricsSource, 40), lyricsEdited: value.lyricsEdited === true,
    artworkUrl: source === 'local' ? '' : field(value.artworkUrl, 4000), mediaMid: field(value.mediaMid, 100),
    creatorId: field(value.creatorId,40),
    creatorName: field(value.creatorName,2000),
    songId: Number.isSafeInteger(value.songId) && value.songId >= 0 ? value.songId : 0, songType: Number.isSafeInteger(value.songType) ? value.songType : 0,
  };
}
export function normalizePlaylists(values, trackIds) {
  if (!Array.isArray(values) || values.length > LIMITS.playlists) throw new Error('Invalid playlist count in backup');
  const ids = new Set();
  return values.map(value => {
    if (!object(value) || !validId(value.id) || ids.has(value.id)) throw new Error('Duplicate or invalid playlist identifier in backup');
    ids.add(value.id);
    const name = field(value.name, 80).trim();
    if (!name || !Array.isArray(value.trackIds) || value.trackIds.length > LIMITS.tracks || new Set(value.trackIds).size !== value.trackIds.length || value.trackIds.some(id => !trackIds.has(id))) throw new Error('Playlist contains duplicate or missing tracks');
    const details=playlistDetails(value);
    if(details.background==='song' && !value.trackIds.includes(details.backgroundTrackId)){details.background='none';details.backgroundTrackId='';}
    return { id: value.id, name, trackIds: value.trackIds.slice(), createdAt: Number.isSafeInteger(value.createdAt) && value.createdAt >= 0 ? value.createdAt : 0,...details };
  });
}
export function normalizePreferences(value, trackIds) {
  const input = object(value) ? value : {};
  const currentId=validId(input.currentId) && (!trackIds || trackIds.has(input.currentId))?input.currentId:'';
  const queue=[];let queueIndex=-1;
  if(Array.isArray(input.queue))for(let i=0;i<input.queue.length && queue.length<LIMITS.tracks;i++) {
    const id=input.queue[i];if(!validId(id) || trackIds && !trackIds.has(id))continue;
    if(Number.isSafeInteger(input.queueIndex) && input.queueIndex===i && id===currentId)queueIndex=queue.length;
    queue.push(id);
  }
  if(queueIndex<0)queueIndex=queue.indexOf(currentId);
  return {
    audioEffects:soundSettings(input.audioEffects),
    recognitionMode:['auto','offline','online'].includes(input.recognitionMode)?input.recognitionMode:'auto',
    theme: ['system', 'light', 'dark'].includes(input.theme) ? input.theme : DEFAULTS.theme,
    autoOpen: typeof input.autoOpen === 'boolean' ? input.autoOpen : DEFAULTS.autoOpen,
    recordListening:input.recordListening!==false,
    autoCache:input.autoCache===true && input.cacheLimitMb!==0,cacheLimitMb:CACHE_BUDGETS.includes(input.cacheLimitMb)?input.cacheLimitMb:1024,cacheKeepFavorites:input.cacheKeepFavorites!==false,
    radioStationId:typeof input.radioStationId==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.radioStationId)?input.radioStationId.toLowerCase():'',
    reduceMotion: input.reduceMotion === true, volume: Number.isFinite(input.volume) ? Math.max(0, Math.min(100, input.volume)) : DEFAULTS.volume,
    ...libraryPreferences(input),
    font:['sans','serif','wenkai','nunito'].includes(input.font)?input.font:'sans',
    motionPreset:input.motionPreset==='slow'?'slow':'fast',
    lyricsSize:Number.isFinite(input.lyricsSize)?Math.max(18,Math.min(40,input.lyricsSize)):26,
    guideEnabled:input.guideEnabled!==false,guideSeen:[...new Set((Array.isArray(input.guideSeen)?input.guideSeen:[]).filter(s=>typeof s==='string' && /^[a-z-]{1,50}$/.test(s)))].slice(0,80),
    currentId,
    position: Number.isFinite(input.position) ? Math.max(0, Math.min(2_592_000_000, input.position)) : 0,
    queue,queueIndex,queueLocked:input.queueLocked===true,shuffle:input.shuffle===true,repeat: ['OFF', 'ALL', 'ONE'].includes(input.repeat) ? input.repeat : DEFAULTS.repeat,
    searchHistory:searchHistory(input.searchHistory),
    searchPreference: ['qq','bili','netease'].includes(input.searchPreference) ? input.searchPreference : DEFAULTS.searchPreference,
    biliQuality: [16,32,64,74,80,112,116,120,125,126,127].includes(input.biliQuality)?input.biliQuality:80,
    liveQuality: Number.isSafeInteger(input.liveQuality) && input.liveQuality>=80 && input.liveQuality<=30000?input.liveQuality:80,
    danmakuEnabled: input.danmakuEnabled===true,
    danmakuSize: Number.isFinite(input.danmakuSize)?Math.max(12,Math.min(36,input.danmakuSize)):22,
    danmakuAlpha: Number.isFinite(input.danmakuAlpha)?Math.max(.1,Math.min(1,input.danmakuAlpha)):.85,
    danmakuArea: Number.isFinite(input.danmakuArea)?Math.max(.25,Math.min(.85,input.danmakuArea)):.5,
    danmakuSpeed: Number.isFinite(input.danmakuSpeed)?Math.max(.5,Math.min(2,input.danmakuSpeed)):1,
    danmakuDensity: Number.isFinite(input.danmakuDensity)?Math.max(4,Math.min(24,Math.round(input.danmakuDensity))):16,
    danmakuFps: [15,30,60].includes(input.danmakuFps)?input.danmakuFps:30,
    danmakuBlocked: typeof input.danmakuBlocked==='string'?input.danmakuBlocked.slice(0,1000):'',
  };
}

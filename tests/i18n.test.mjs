import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {currentLanguage,setLanguage,translate,languageMessages,tr} from '../web/i18n.mjs';
import {normalizePreferences} from '../web/library-data.mjs';
import {LibraryStore} from '../web/storage.mjs';
import {createBackup,readBackup} from '../web/backup.mjs';
import {showDownloadNotification} from '../web/web-integration.mjs';

test('English is the default regardless of device language; only supported preferences are accepted',()=>{
  assert.equal(currentLanguage(),'en');
  for(const value of [undefined,null,'zh','system','fr',{},1])assert.equal(normalizePreferences({language:value}).language,'en');
  assert.equal(normalizePreferences({language:'zh-CN'}).language,'zh-CN');
});

test('all localized templates preserve placeholder identities and opaque content',()=>{
  const slots=s=>[...s.matchAll(/\{(\d+)\}/g)].map(m=>m[1]).sort();
  for(const [english,chinese] of Object.entries(languageMessages()))assert.deepEqual(slots(chinese),slots(english),english);
  assert.equal(translate('zh-CN','Tinglan · {0}','Home / 海风 {0}'),'听岚 · Home / 海风 {0}');
  assert.equal(translate('en','Tinglan · {0}','首页'),'Tinglan · 首页');
  assert.equal(translate('zh-CN','Unmapped platform error'),'Unmapped platform error');
});

test('language changes are immediate, can be reversed repeatedly, and tolerate blocked storage',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('blocked');}});
  try{for(let n=0;n<100;n++){setLanguage('zh-CN');assert.equal(tr('Home'),'首页');setLanguage('en');assert.equal(tr('Home'),'Home');}}
  finally{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;setLanguage('en');}
});

test('boot language mirror survives module recreation and invalid values fall back to English',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),values=new Map();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)}});
  try{
    setLanguage('zh-CN');const next=await import('../web/i18n.mjs?reload=zh');assert.equal(next.currentLanguage(),'zh-CN');
    setLanguage('en');const english=await import('../web/i18n.mjs?reload=en');assert.equal(english.currentLanguage(),'en');
  }finally{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;setLanguage('en');}
});

test('language survives IndexedDB reopening and backup restore without altering media content',async()=>{
  const previous=globalThis.indexedDB;globalThis.indexedDB=new IDBFactory();
  let first,second;
  try{
    first=new LibraryStore();await first.open();await first.saveSettings(normalizePreferences({language:'zh-CN'}));first.db.close();
    second=new LibraryStore();await second.open();assert.equal((await second.settings()).language,'zh-CN');
    const audio=new Blob(['test audio'],{type:'audio/wav'});
    const input={tracks:[{id:'local-language',title:'Home / 海风',artist:'首页',size:audio.size,lyrics:'[00:01]Home / 海风'}],media:[{id:'local-language',blob:audio}],artwork:[],playlists:[],preferences:await second.settings()};
    const restored=await readBackup((await createBackup(input)).blob);
    assert.equal(restored.preferences.language,'zh-CN');assert.equal(restored.tracks[0].title,input.tracks[0].title);assert.equal(restored.tracks[0].lyrics,input.tracks[0].lyrics);
  }finally{first?.db?.close();second?.db?.close();globalThis.indexedDB=previous;}
});

test('background notifications use the saved language while keeping track titles intact',async()=>{
  const previous=globalThis.Notification,shown=[];globalThis.Notification={permission:'granted'};
  const registration={showNotification:async(title,options)=>shown.push({title,options})};
  try{
    await showDownloadNotification(registration,{title:'Home / 海风',language:'zh-CN'},true);
    await showDownloadNotification(registration,{title:'Home / 海风',language:'en'},true);
    assert.equal(shown[0].title,translate('zh-CN','Music cached'));assert.equal(shown[1].title,'Music cached');assert.equal(shown[0].options.body,'Home / 海风');
  }finally{globalThis.Notification=previous;}
});

import {messages} from './locales/zh-CN.mjs';
import {storageName} from './deployment.mjs';

export const LANGUAGES=Object.freeze(['en','zh-CN']);
let selected='en';
try{selected=normalizeLanguage(globalThis.localStorage?.getItem(storageName('tinglan-language')));}catch{/* Storage is optional. */}
export function normalizeLanguage(value){return value==='zh-CN'?'zh-CN':'en';}
export function currentLanguage(){return selected;}
export function setLanguage(value){selected=normalizeLanguage(value);try{globalThis.localStorage?.setItem(storageName('tinglan-language'),selected);}catch{/* IndexedDB preferences remain authoritative. */}return selected;}
export function languageMessages(){return messages;}
export function translate(language,key,...values){
  const pattern=language==='zh-CN'?(messages[key] ?? key):key;
  return values.length?String(pattern).replace(/\{(\d+)\}/g,(match,index)=>index<values.length?String(values[index] ?? ''):match):String(pattern);
}
/** Only interface templates are translated. Interpolated media/user text is opaque. */
export function tr(key,...values){return translate(selected,key,...values);}

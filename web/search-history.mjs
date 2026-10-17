export const SEARCH_HISTORY_LIMIT=30;
export function searchTerm(value) {
  return typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().replace(/\s+/gu,' ').slice(0,200):'';
}
export function searchHistory(values) {
  const result=[],seen=new Set();
  for(const value of Array.isArray(values)?values:[]) {
    const term=searchTerm(value),key=term.toLocaleLowerCase();
    if(!term || seen.has(key))continue;
    result.push(term);seen.add(key);if(result.length===SEARCH_HISTORY_LIMIT)break;
  }
  return result;
}
export function rememberSearch(values,value) {
  const term=searchTerm(value);return term?searchHistory([term,...searchHistory(values)]):searchHistory(values);
}
export function forgetSearch(values,value) {
  const key=searchTerm(value).toLocaleLowerCase();return searchHistory(values).filter(term=>term.toLocaleLowerCase()!==key);
}

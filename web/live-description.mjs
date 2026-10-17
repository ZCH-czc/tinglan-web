// Display platform rich descriptions as bounded paragraphs in the self-drawn UI.
const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
function entities(value) {return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(whole,key)=>{
  if(key[0]!=='#')return named[key.toLowerCase()] ?? whole;
  const code=key[1]?.toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
  return code>0 && code<=0x10ffff && !(code>=0xd800 && code<=0xdfff)?String.fromCodePoint(code):'';
});}
export function liveDescription(value) {
  return entities(entities(String(value ?? '').slice(0,24000)))
    .replace(/<!--[^]*?-->/g,'').replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi,'')
    .replace(/<(?:br\b[^>]*|\/p|\/div|\/li)>/gi,'\n').replace(/<\/?[a-z][^>]*>/gi,'')
    .replace(/[\t\r ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim().slice(0,8000);
}

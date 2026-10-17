import {readFile,writeFile,stat} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {brotliDecompressSync,gunzipSync} from 'node:zlib';

const root=resolve(process.argv[2] || 'build/dist'),manifest=JSON.parse(await readFile(resolve(root,'asset-manifest.json'),'utf8'));
let rawBytes=0,brotliBytes=0,compressionVariantsVerified=0;
for(const item of manifest.assets) {
  const path=resolve(root,item.url);if(!path.startsWith(root+sep))throw new Error('Asset escapes distribution');
  const bytes=await readFile(path);if(bytes.length!==item.size || createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new Error('Asset mismatch: '+item.url);
  rawBytes+=bytes.length;let smallest=bytes.length;
  for(const [suffix,unpack] of [['.br',brotliDecompressSync],['.gz',gunzipSync]]) {
    const compressed=await readFile(path+suffix).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(!compressed)continue;
    if(!unpack(compressed).equals(bytes))throw new Error('Compression mismatch: '+item.url+suffix);++compressionVariantsVerified;
    if(suffix==='.br')smallest=Math.min(smallest,compressed.length);
  }
  brotliBytes+=smallest;
}
const binaries=[];
for(const required of ['engine/tinglan-web-core.wasm','ui/tinglan-web-ui.wasm','ui/skiko.wasm','recognition/afp.wasm'])if(!manifest.assets.some(item=>item.url===required))throw new Error('Required Wasm missing: '+required);
for(const file of manifest.assets.filter(item=>item.url.endsWith('.wasm')).map(item=>item.url)) {
  const bytes=await readFile(resolve(root,file));if(!WebAssembly.validate(bytes))throw new Error('Invalid Wasm: '+file);
  binaries.push({path:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),validated:true});
}
for(const removed of ['app.mjs','styles.css'])if(await stat(resolve(root,removed)).then(()=>true,()=>false))throw new Error('Obsolete UI present');
const index=await readFile(resolve(root,'index.html'),'utf8');if(/<(button|input|select|textarea)\b/i.test(index))throw new Error('Native visible HTML control found');
const worker=await readFile(resolve(root,'service-worker.mjs'),'utf8');if(worker.includes('__TINGLAN_'))throw new Error('Unexpanded worker manifest');
const notices=await readFile(resolve(root,'THIRD_PARTY_NOTICES.txt'),'utf8');for(const name of ['Noto Sans','Noto-Color-Emoji-OFL.txt','music-metadata','@js-joda/core','Skia-LICENSE','hls.js 1.7.3','qrcode 1.5.4'])if(!notices.includes(name))throw new Error('Notice missing: '+name);
const report={version:manifest.version,build:manifest.build,assets:manifest.assets.length,allAssetHashesVerified:true,compressionVariantsVerified,binaries,rawBytes,brotliBytes,browserUiAccepted:false};
if(process.argv[3])await writeFile(resolve(process.argv[3]),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));

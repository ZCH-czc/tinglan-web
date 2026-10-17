import { cp,readdir,readFile,writeFile,mkdir,rm,rename,stat } from 'node:fs/promises';
import { resolve,dirname,relative,sep,basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { brotliCompress,gzip,constants } from 'node:zlib';
import { promisify } from 'node:util';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const build=resolve(root,'build');
const target=resolve(build,process.argv[2] || 'dist'),input=resolve(build,process.argv[3] || 'package');
if(dirname(input)!==build || dirname(target)!==build || input===target)throw new Error('Invalid distribution paths');
const stage=resolve(build,basename(target)+'-staging'),previous=resolve(build,basename(target)+'-previous');
for(const path of [stage,target,previous])if(!path.startsWith(build+sep) || dirname(path)!==build)throw new Error('Unexpected generated output directory');
await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});
await cp(input,stage,{recursive:true});
async function files(dir){const result=[];for(const row of await readdir(dir,{withFileTypes:true})){const path=resolve(dir,row.name);if(row.isDirectory())result.push(...await files(path));else if(row.isFile())result.push(path);}return result;}
const paths=(await files(stage)).filter(p=>!p.endsWith('.map') && !p.endsWith('.d.ts') && !p.endsWith('/service-worker.mjs'));
const entries=[];for(const path of paths.filter(p=>relative(stage,p).replaceAll('\\','/')!=='service-worker.mjs')){const bytes=await readFile(path);entries.push({url:relative(stage,path).replaceAll('\\','/'),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
entries.sort((a,b)=>a.url.localeCompare(b.url));
const id=createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0,24);
const source=await readFile(resolve(stage,'service-worker.mjs'),'utf8');
await writeFile(resolve(stage,'service-worker.mjs'),source.replace('__TINGLAN_BUILD_ID__',id).replace('__TINGLAN_ASSET_MANIFEST__',JSON.stringify(entries.map(e=>e.url))));
await writeFile(resolve(stage,'asset-manifest.json'),JSON.stringify({version:'0.31.2',build:id,assets:entries},null,2)+'\n');
let raw=0,packed=0;const pending=(await files(stage)).filter(p=>/\.(?:wasm|mjs|js|css|html|otf|ttf|txt|json|webmanifest|svg)$/.test(p));
async function compress(){while(pending.length){const path=pending.shift(),bytes=await readFile(path);raw+=bytes.length;const brotli=await promisify(brotliCompress)(bytes,{params:{[constants.BROTLI_PARAM_QUALITY]:6}});const gz=await promisify(gzip)(bytes,{level:6});packed+=Math.min(bytes.length,brotli.length);if(brotli.length<bytes.length)await writeFile(path+'.br',brotli);if(gz.length<bytes.length)await writeFile(path+'.gz',gz);}}
await Promise.all([compress(),compress()]);
await rm(previous,{recursive:true,force:true});let hadPrevious=false;
try{await stat(target);await rename(target,previous);hadPrevious=true;}catch(error){if(error.code!=='ENOENT')throw error;}
try{await rename(stage,target);}catch(error){if(hadPrevious)await rename(previous,target);throw error;}
await rm(previous,{recursive:true,force:true});
console.log(`Prepared self-drawn Web 0.31.2: ${entries.length} assets, ${(raw/1048576).toFixed(2)} MB raw / ${(packed/1048576).toFixed(2)} MB Brotli.`);

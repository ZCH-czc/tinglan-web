import {cp, mkdir, readFile, writeFile, rm, readdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const stage=resolve(root,'build/pages-package');
if(dirname(stage)!==resolve(root,'build'))throw new Error('Unsafe Pages staging path');
await rm(stage,{recursive:true,force:true});
await mkdir(stage,{recursive:true});
await cp(resolve(root,'build/package'),stage,{recursive:true});
const config=resolve(stage,'deployment.mjs');
const original=await readFile(config,'utf8');
if(!original.includes("export const DEPLOYMENT = 'companion';"))throw new Error('Unexpected deployment configuration');
await writeFile(config,original.replace("export const DEPLOYMENT = 'companion';","export const DEPLOYMENT = 'static';"));
await writeFile(resolve(stage,'.nojekyll'),'');
for(const script of [['optimize-web.mjs','pages','pages-package'],['verify-distribution.mjs','build/pages']]){
  const result=spawnSync(process.execPath,[resolve(root,'scripts',script[0]),...script.slice(1)],{cwd:root,stdio:'inherit'});
  if(result.status!==0)process.exit(result.status || 1);
}
// Pages handles compression itself. Do not upload unused duplicate payloads.
async function strip(directory){
  for(const item of await readdir(directory,{withFileTypes:true})){
    const path=resolve(directory,item.name);
    if(item.isDirectory())await strip(path);
    else if(/\.(br|gz|map|d\.ts)$/.test(item.name))await rm(path);
  }
}
await strip(resolve(root,'build/pages'));
console.log('Prepared GitHub Pages application in build/pages.');

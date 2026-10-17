import { build } from 'esbuild';
import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {createHash} from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'build/browser');
if (out !== resolve(root, 'build', 'browser')) throw new Error('Unexpected generated output path');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const recognitionSource=resolve(root,'vendor/netease-recognition');
await mkdir(resolve(out,'recognition'),{recursive:true});
for(const [name,hash] of [['afp.wasm','8064415bb66e45410e88877f07cd007a3ae62ebf463aac13c159a8f13e4c8fe8'],['afp-bindings.js','40ac6be12704ea07983dc0ad807b0c047ee7c26ba1dd0018625909ecacb2303d']]){
  const bytes=await readFile(resolve(recognitionSource,name));if(createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error('Pinned recognition asset changed: '+name);
  if(name.endsWith('.wasm'))await writeFile(resolve(out,'recognition',name),bytes);
  else {
    // Embind only uses this generated Function to name wrappers. A normal closure keeps behavior without eval.
    const old='function ht(t,e){return t=dt(t),new Function("body","return function "+t+\'() {\\n    "use strict";    return body.apply(this, arguments);\\n};\\n\')(e)}';
    let source=bytes.toString('utf8');if(!source.includes(old))throw new Error('Unexpected AFP wrapper');
    source=source.replace('window.createNeteaseAfp=','export const createNeteaseAfp=').replace(old,'function ht(t,e){return function(){return e.apply(this,arguments)}}').replace('y="object"==typeof process&&"object"==typeof process.versions&&"string"==typeof process.versions.node','y=false');
    if(source.includes('new Function') || source.includes('window.createNeteaseAfp='))throw new Error('AFP browser adaptation failed');
    await writeFile(resolve(out,'recognition/afp-bindings.mjs'),source);
  }
}
await cp(resolve(recognitionSource,'NOTICE.txt'),resolve(out,'recognition/NOTICE.txt'));
const result = await build({
  absWorkingDir: root, entryPoints: [resolve(root, 'web/metadata-worker.mjs'),resolve(root,'web/hls-adapter.mjs'),resolve(root,'web/login-qr.mjs'),resolve(root,'web/local-index-worker.mjs')], outdir: out,
  bundle: true, splitting: true, format: 'esm', platform: 'browser', target: 'es2022',
  outExtension: { '.js': '.mjs' }, chunkNames: 'chunks/[name]-[hash]', minify: true,
  legalComments: 'linked', metafile: true,
});
const uiSource = resolve(root, 'ui/build/compileSync/wasmJs/main/productionExecutable/kotlin');
const skiko = resolve(root, 'ui/build/compose/skiko-runtime-processed-wasmjs');
const uiResult = await build({
  absWorkingDir: root, entryPoints: [resolve(uiSource, 'tinglan-web-ui.mjs')],
  outfile: resolve(out, 'ui/tinglan-web-ui.mjs'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  external: ['node:*', 'module', 'https://*'], minify: true, legalComments: 'linked', metafile: true,
  plugins: [{ name: 'local-skiko', setup(context) {
    context.onResolve({ filter: /^\.\/skiko\.mjs$/ }, () => ({ path: resolve(skiko, 'skiko.mjs') }));
    context.onResolve({ filter: /^@js-joda\/core$/ }, () => ({ path: resolve(root, 'node_modules/@js-joda/core/dist/js-joda.esm.js') }));
  } }],
});
await cp(resolve(uiSource, 'tinglan-web-ui.wasm'), resolve(out, 'ui/tinglan-web-ui.wasm'));
await cp(resolve(skiko, 'skiko.wasm'), resolve(out, 'ui/skiko.wasm'));
const packages = new Map();
for (const input of Object.keys({ ...result.metafile.inputs, ...uiResult.metafile.inputs })) {
  if (!input.includes('node_modules/')) continue;
  let current = dirname(resolve(root, input));
  while (current.startsWith(root) && current !== root) {
    try {
      const info = JSON.parse(await readFile(resolve(current, 'package.json'), 'utf8'));
      if (info.name) { packages.set(info.name, { ...info, directory: current }); break; }
    } catch { /* A source subdirectory is not a package boundary. */ }
    current = dirname(current);
  }
}
const notices = [];
for(const file of ['Apache-2.0.txt','Compose-LICENSE.txt','Skia-LICENSE.txt','Skiko-NOTICE.txt','Noto-Serif-SC-OFL.txt','LXGW-WenKai-Lite-OFL.txt','Nunito-OFL.txt','Noto-Color-Emoji-OFL.txt']) {
  notices.push(`${file}\n${await readFile(resolve(root,'web/licenses',file),'utf8')}`);
}
notices.push(`Noto Sans SC / Source Han Sans · SIL OFL 1.1\n${await readFile(resolve(root,'web/Noto-Sans-SC-OFL.txt'),'utf8')}`);
for (const [name, info] of [...packages].sort()) {
  let license = '';
  for (const file of ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'license', 'license.txt']) {
    try { license = await readFile(resolve(info.directory, file), 'utf8'); break; } catch { /* Next conventional filename. */ }
  }
  if (!license) throw new Error(`License text missing for bundled ${name}`);
  notices.push(`${name} ${info.version} · ${info.license}\n${license}`);
}
await writeFile(resolve(out, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n\n--------------------\n\n'));
console.log(`Bundled local metadata worker with ${packages.size} dependency license notices.`);

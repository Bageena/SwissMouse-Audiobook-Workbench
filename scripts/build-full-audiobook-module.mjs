import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {build as bundle} from 'esbuild';
import {build as viteBuild} from 'vite';
import AdmZip from 'adm-zip';

const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function sharedRuntime(){
  const exportsFor=(library,globalName)=>{const names=Object.keys(require(library)).filter(name=>/^[a-zA-Z_$][\w$]*$/.test(name)&&name!=='default');return `const runtime=globalThis.${globalName};if(!runtime)throw new Error('SwissMouse must provide the shared ${library} runtime.');export default runtime;\n`+names.map(name=>`export const ${name}=runtime.${name};`).join('\n');};
  return {name:'swissmouse-shared-react',enforce:'pre',resolveId(id){if(['react','react-dom','react/jsx-runtime','react/jsx-dev-runtime'].includes(id))return '\0swissmouse:'+id;},load(id){
    if(id==='\0swissmouse:react')return exportsFor('react','__SWISSMOUSE_MODULE_REACT__');
    if(id==='\0swissmouse:react-dom')return exportsFor('react-dom','__SWISSMOUSE_MODULE_REACT_DOM__');
    if(id==='\0swissmouse:react/jsx-runtime'||id==='\0swissmouse:react/jsx-dev-runtime')return `const React=globalThis.__SWISSMOUSE_MODULE_REACT__;export const Fragment=React.Fragment;export function jsx(type,props,key){return React.createElement(type,{...props,...(key===undefined?{}:{key})});}export const jsxs=jsx;export const jsxDEV=jsx;`;
  },generateBundle(_options,outputs){for(const output of Object.values(outputs))if(output.type==='chunk')for(const file of Object.keys(output.modules))if(/[/\\]node_modules[/\\](react|react-dom)[/\\]/.test(file))throw new Error('A full module must use the host React runtime: '+file);}};
}
function sources(){
  const zip=new AdmZip();
  const allowed=/\.(ts|tsx|mjs|cjs|js|css|svg|png|jpg|jpeg|webp|woff2?|py|md|txt|json|html|ps1|bat)$/i;
  for(const directory of ['src','tools','packages','scripts']){
    const walk=relative=>{for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true})){
      const file=path.join(relative,entry.name);if(entry.isSymbolicLink())throw new Error('Source snapshot contains a link: '+file);
      if(entry.isDirectory()){if(!['node_modules','.cache','dist','__pycache__','local','yt-dlp'].includes(entry.name))walk(file);}
      else if(allowed.test(entry.name)||entry.name==='package.json')zip.addFile(file.replaceAll('\\','/'),fs.readFileSync(path.join(root,file)));
    }};walk(directory);
  }
  for(const file of ['server.ts','package.json','package-lock.json','tsconfig.json','vite.config.ts','LICENSE','THIRD_PARTY.md'])zip.addFile(file,fs.readFileSync(path.join(root,file)));
  zip.addFile('README-MODULE.md',Buffer.from('SwissMouse Audiobook Workbench preferred source. AGPL-3.0-or-later.\nRepository target: https://github.com/Bageena/SwissMouse-Audiobook-Workbench\nCore target: https://github.com/Bageena/SwissMouse\nBuild against the included matching SDK source with npm ci, then npm run module:build:full. This archive contains first-party source/assets and dependency manifests, not dependency installations, media, libraries, local settings, runtimes or models. Core-only experimental source may remain in the development snapshot; it is not imported by this module build.\n'));
  return zip.toBuffer();
}
export async function buildFullAudiobookModule({output=path.join(root,'.cache','full-module-packages'),version='0.0.3'}={}){
  if(!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(version))throw new Error('Invalid module version.');
  fs.mkdirSync(output,{recursive:true});const work=fs.mkdtempSync(path.join(output,'build-')),web=path.join(work,'web'),files=new Map();
  try{
    await viteBuild({root,base:'./',configFile:path.join(root,'vite.config.ts'),plugins:[sharedRuntime()],build:{outDir:web,emptyOutDir:true,copyPublicDir:false,rollupOptions:{input:path.join(root,'packages/audiobooks/src/application-client.tsx'),preserveEntrySignatures:'strict',output:{entryFileNames:'client.mjs',chunkFileNames:'chunks/[name]-[hash].mjs',assetFileNames:'assets/[name]-[hash][extname]',inlineDynamicImports:true}},sourcemap:false,minify:true}});
    const walkWeb=relative=>{for(const entry of fs.readdirSync(path.join(web,relative),{withFileTypes:true})){const name=path.posix.join(relative.replaceAll('\\','/'),entry.name);if(entry.isDirectory())walkWeb(name);else files.set('web/'+name,fs.readFileSync(path.join(web,name)));}};walkWeb('');
    for(const [entry,name]of [['server.ts','backend.cjs'],['tools/catalog-worker.ts','catalog-worker.cjs']]){
      const result=await bundle({entryPoints:[path.join(root,entry)],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,minifySyntax:true,define:{'process.env.SWISSMOUSE_APPLICATION_BUILD':'"1"'},metafile:true});
      if(Object.keys(result.metafile.inputs).some(file=>file.endsWith('tools/core-host.ts')))throw new Error('The Audiobook backend imported the Core host.');
      files.set(name,Buffer.from(result.outputFiles[0].contents));
    }
    files.set('source.zip',sources());files.set('LICENSE',fs.readFileSync(path.join(root,'LICENSE')));files.set('THIRD_PARTY.md',fs.readFileSync(path.join(root,'THIRD_PARTY.md')));
    files.set('README.txt',Buffer.from('Full SwissMouse Audiobook Workbench candidate. Host protocol 2, React 18. Uses the host Node and React runtimes. No Python, FFmpeg, other external programs or models are included. Preferred source and build instructions are in source.zip. Data remains in the existing installation stores and assets; removal must preserve them.\n'));
    const detailsFile=path.join(root,'packages/audiobooks/src/requirement-details.ts');
    const details=await bundle({entryPoints:[detailsFile],bundle:true,platform:'node',format:'cjs',write:false});const evaluate=new Function('module','exports',Buffer.from(details.outputFiles[0].contents).toString());const metadataModule={exports:{}};evaluate(metadataModule,metadataModule.exports);const requirementMetadata=metadataModule.exports.audiobookRequirementDetails;
    // Compatibility routes belong to the module. Core and module management are never proxy claims.
    const routes=new Set(['/api/module-lifecycle']);
    for(const directory of ['server.ts','tools']){
      const paths=directory==='server.ts'?[path.join(root,directory)]:fs.readdirSync(path.join(root,directory)).filter(name=>name.endsWith('.ts')&&!name.includes('.test.')).map(name=>path.join(root,directory,name));
      for(const file of paths)for(const match of fs.readFileSync(file,'utf8').matchAll(/['"`]\/api\/([a-z][a-z0-9-]*)/g))if(!['core','modules','appearance'].includes(match[1]))routes.add('/api/'+match[1]);
    }
    const styles=[...files.keys()].filter(name=>name.endsWith('.css')),assets=[...files.keys()].filter(name=>name.startsWith('web/')&&!styles.includes(name)&&name!=='web/client.mjs');
    assets.push('source.zip','LICENSE','THIRD_PARTY.md');
    const publicAssets=Object.fromEntries(assets.filter(name=>name.startsWith('web/')).map(name=>['/'+name.slice(4),name]));
    const manifest={format:'swissmouse.module',id:'audiobooks',publisher:'swissmouse-development',name:'Audiobook Workbench',version,apiVersion:2,sdkVersion:'0.0.2',reactMajor:18,browser:'web/client.mjs',backend:'backend.cjs',styles,assets,operations:[],panels:[],application:{kind:'node-http-workspace',health:'/api/operations/status',prepareRemoval:'/api/module-lifecycle/prepare-removal',routes:[...routes].sort(),requirements:requirementMetadata,publicAssets},files:Object.fromEntries([...files].map(([name,bytes])=>[name,digest(bytes)]))};
    const archive=new AdmZip();archive.addFile('module.json',Buffer.from(JSON.stringify(manifest,null,2)));for(const[name,bytes]of files)archive.addFile(name,bytes);
    const bytes=archive.toBuffer(),sha256=digest(bytes),artifact=path.join(output,`audiobooks-full-${version}.smmodule`);fs.writeFileSync(artifact,bytes);
    return {artifact,sha256,manifest,catalogEntry:{id:manifest.id,publisher:manifest.publisher,version,sha256}};
  }finally{fs.rmSync(work,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===import.meta.filename){const result=await buildFullAudiobookModule();fs.writeFileSync(path.join(path.dirname(result.artifact),'module-trust.json'),JSON.stringify({schemaVersion:1,packages:[result.catalogEntry]},null,2)+'\n');console.log(JSON.stringify({artifact:result.artifact,sha256:result.sha256,files:Object.keys(result.manifest.files).length,routes:result.manifest.application.routes},null,2));}

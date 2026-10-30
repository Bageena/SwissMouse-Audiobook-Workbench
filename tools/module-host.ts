import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import type { InstalledModuleManifest, PanelContext, ServerContribution, ServerSdk } from '../packages/sdk';
import type {ApplicationModuleManifest} from '../packages/sdk/applications';
import type {Request,Response} from 'express';
import {ApplicationRuntime} from './application-runtime';
import {createRequirementRegistry} from '../packages/sdk/dependencies';
type Manifest=InstalledModuleManifest|ApplicationModuleManifest;

export const moduleDigest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const shaPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-z][a-z0-9-]{0,63}$/;
export const safeModulePath = (name: string) => typeof name === 'string' && name.length < 180 && /^[a-zA-Z0-9_./-]+$/.test(name)
  && name.split('/').every(part => !!part && part !== '.' && part !== '..' && !part.endsWith('.') && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part));

export function validateModuleManifest(value: unknown, applications=false): Manifest {
  const m = value as Manifest;
  if (!m || m.format !== 'swissmouse.module' || !idPattern.test(m.id) || ['constructor', 'prototype', '__proto__'].includes(m.id) || !idPattern.test(m.publisher)
    || typeof m.name !== 'string' || !m.name.trim() || m.name.length > 100 || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(m.version)
    || (m.apiVersion !== 1 && (!applications||m.apiVersion!==2)) || m.reactMajor !== 18) throw new Error('Malformed or incompatible module manifest (supported API / React 18 required).');
  if (!m.files || typeof m.files !== 'object' || Array.isArray(m.files) || Object.keys(m.files).length > (m.apiVersion===2?400:80)
    || Object.entries(m.files).some(([name, hash]) => !safeModulePath(name) || ['module.json', 'package.smmodule'].includes(name) || !shaPattern.test(hash))) throw new Error('Invalid module file inventory.');
  if (!m.browser?.endsWith('.mjs') || !m.backend?.endsWith(m.apiVersion===2?'.cjs':'.mjs') || !m.files[m.browser] || !m.files[m.backend]
    || !Array.isArray(m.styles) || m.styles.some(file => !file.endsWith('.css') || !Object.hasOwn(m.files, file))
    || !Array.isArray(m.assets) || m.assets.some(file => (m.apiVersion===1&&!file.endsWith('.svg')) || !Object.hasOwn(m.files, file))) throw new Error('Invalid module entry points.');
  if(m.apiVersion===2){
    if(m.sdkVersion!=='0.0.2')throw new Error('Full workspace requires compatible SDK 0.0.2.');
    const a=m.application;
    if(!a||a.kind!=='node-http-workspace'||!Array.isArray(a.routes)||!a.routes.length||a.routes.length>50||a.routes.some(route=>!/^\/api\/[a-z][a-z0-9-]*$/.test(route)||['/api/core','/api/modules','/api/appearance'].includes(route))||new Set(a.routes).size!==a.routes.length||typeof a.health!=='string'||typeof a.prepareRemoval!=='string'||![a.health,a.prepareRemoval].every(url=>/^\/api\/[a-z0-9/-]+$/.test(url)&&a.routes.some(route=>url.startsWith(route+'/')))||!a.publicAssets||typeof a.publicAssets!=='object'||Array.isArray(a.publicAssets)||Object.entries(a.publicAssets).some(([url,file])=>!/^\/[a-zA-Z0-9_./-]+$/.test(url)||url.includes('..')||!m.assets.includes(file))||!a.requirements||typeof a.requirements!=='object'||Array.isArray(a.requirements)||!Array.isArray(m.operations)||!Array.isArray(m.panels)||m.operations.length||m.panels.length)throw new Error('Invalid full-workspace application contract.');
    createRequirementRegistry().activate(m.id,a.requirements)();
    return m;
  }
  const owned = (id: string) => typeof id === 'string' && id.startsWith(m.id + '.') && /^[a-z][a-z0-9.-]+$/.test(id);
  if (!Array.isArray(m.operations) || !m.operations.length || m.operations.length > 8 || m.operations.some(id => !owned(id)) || new Set(m.operations).size !== m.operations.length
    || !Array.isArray(m.panels) || !m.panels.length || m.panels.length > 8 || m.panels.some(p => !p || !owned(p.id) || typeof p.title !== 'string' || !p.title.trim() || p.title.length > 100 || !m.operations.includes(p.operation))
    || new Set(m.panels.map(p => p.id)).size !== m.panels.length) throw new Error('Invalid or unowned module contributions.');
  return m;
}

type Installed = { sha256: string; manifest: Manifest; enabled: boolean };
export interface ModuleHostOptions {
  appRoot: string;
  readRecord: ServerSdk['readRecord'];
  /** Locally provisioned administrator trust, not a downloaded self-asserted publisher. */
  catalogFile?: string;
  applications?:boolean;
}

/** Restart-based, trusted first-party proof. No arbitrary plugins, background jobs or write operations. */
export class ModuleHost {
  packageByteLimit(){return (this.options.applications?64:6)*1024*1024;}
  private root: string;
  private records: Record<string, Installed> = {};
  private active = new Map<string, { record: Installed; contribution: ServerContribution }>();
  private applications=new Map<string,ApplicationRuntime>();
  private errors = new Map<string, string>();
  private registryError = '';
  private closing=false;
  constructor(private options: ModuleHostOptions) {
    this.root = path.resolve(options.appRoot, '.installed-modules');
    try {
      this.directory(this.root);
      const file = this.file('installed.json');
      if (fs.existsSync(file)) {
        if (fs.statSync(file).size > 2 * 1024 * 1024) throw new Error('Installed-module registry exceeds the size limit.');
        const state = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (state.schemaVersion !== 1 || !Array.isArray(state.modules) || state.modules.length > 32) throw new Error('Invalid installed-module registry.');
        for (const record of state.modules as Installed[]) {
          const m = validateModuleManifest(record.manifest,options.applications);
          if (!shaPattern.test(record.sha256) || typeof record.enabled !== 'boolean' || Object.hasOwn(this.records, m.id)) throw new Error('Invalid installed-module record.');
          this.records[m.id] = record;
        }
      }
    } catch (error) { this.registryError = `Module registry needs attention: ${(error as Error).message}`; this.records = {}; }
  }
  private directory(dir: string) {
    const relative = path.relative(this.root, dir);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Module path is outside managed storage.');
    const parts = relative ? relative.split(path.sep) : [];
    for (let i = 0; i <= parts.length; i++) {
      const current = path.join(this.root, ...parts.slice(0, i));
      if (!fs.existsSync(current)) fs.mkdirSync(current);
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Redirected module storage is not allowed.');
    }
  }
  private file(relative: string) {
    if (!safeModulePath(relative)) throw new Error('Unsafe module path.');
    const file = path.join(this.root, relative);
    // Do not follow replaced parents or linked payload files.
    this.directory(path.dirname(file));
    try { if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error('Module file is not a regular file.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return file;
  }
  private catalog(): { sha256: string; id: string; publisher: string; version: string }[] {
    const file = this.options.catalogFile || path.join(this.options.appRoot, 'module-trust.json');
    if (!fs.existsSync(file)) return [];
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Trust catalog cannot be a link.');
    if (fs.statSync(file).size > 128 * 1024) throw new Error('Trust catalog exceeds the size limit.');
    const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.packages) || catalog.packages.length > 100) throw new Error('Invalid local module trust catalog.');
    return catalog.packages;
  }
  private trusted(record: Installed) {
    if (!this.catalog().some(entry => entry.sha256 === record.sha256 && entry.id === record.manifest.id && entry.publisher === record.manifest.publisher && entry.version === record.manifest.version))
      throw new Error('Package is not approved in this installation\'s local trust catalog.');
  }
  private save(next: Record<string, Installed>) {
    if (this.registryError) throw new Error(this.registryError);
    const file = this.file('installed.json');
    const temporary = this.file(`registry-${randomUUID()}.tmp`);
    const fd = fs.openSync(temporary, 'wx');
    try { fs.writeFileSync(fd, JSON.stringify({ schemaVersion: 1, modules: Object.values(next) })); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
    this.records = next;
  }
  private verify(record: Installed) {
    validateModuleManifest(record.manifest,this.options.applications); this.trusted(record);
    const archive = this.file(`${record.sha256}/package.smmodule`);
    if (fs.statSync(archive).size > (record.manifest.apiVersion===2?64:6) * 1024 * 1024) throw new Error('Installed archive exceeds the size limit.');
    const bytes = fs.readFileSync(archive);
    if (moduleDigest(bytes) !== record.sha256) throw new Error('Installed archive failed verification.');
    const originalManifest = new AdmZip(bytes).getEntry('module.json');
    if (!originalManifest || JSON.stringify(JSON.parse(originalManifest.getData().toString('utf8'))) !== JSON.stringify(record.manifest)) throw new Error('Installed manifest differs from the approved archive.');
    for (const [name, hash] of Object.entries(record.manifest.files)) {
      const file = this.file(`${record.sha256}/${name}`);
      if (fs.statSync(file).size > (record.manifest.apiVersion===2?48:5) * 1024 * 1024 || moduleDigest(fs.readFileSync(file)) !== hash) throw new Error(`Installed module payload failed verification: ${name}`);
    }
  }
  async start(safeMode = false) {
    for (const record of Object.values(this.records)) {
      if(this.closing)break;
      if (!record.enabled) continue;
      try {
        if (safeMode) throw new Error('Module execution is disabled by SWISSMOUSE_MODULE_SAFE_MODE. Disable or remove the failing module in Preferences, then restart normally.');
        this.verify(record);
        if(record.manifest.apiVersion===2){
          for(const current of this.active.values())if(current.record.manifest.apiVersion===2&&current.record.manifest.application.routes.some(route=>record.manifest.apiVersion===2&&record.manifest.application.routes.includes(route)))throw new Error('Module compatibility routes conflict with an active module.');
          const application=new ApplicationRuntime(record.manifest,path.join(this.root,record.sha256),this.options.appRoot);
          this.applications.set(record.manifest.id,application);
          try{await application.start();}catch(error){this.applications.delete(record.manifest.id);throw error;}
          if(this.closing){await application.stop();break;}
          this.active.set(record.manifest.id,{record,contribution:{reads:{}}});continue;
        }
        const implementation = await import(pathToFileURL(this.file(`${record.sha256}/${record.manifest.backend}`)).href);
        const sdk: ServerSdk = Object.freeze({ apiVersion: 1, readRecord: this.options.readRecord });
        const contribution = await implementation.activate(sdk) as ServerContribution;
        if (!contribution?.reads || Object.keys(contribution.reads).length !== record.manifest.operations.length || record.manifest.operations.some(id => typeof contribution.reads[id] !== 'function')) throw new Error('Backend contributions do not match the manifest.');
        this.active.set(record.manifest.id, { record, contribution });
      } catch (error) { this.errors.set(record.manifest.id, (error as Error).message); }
    }
  }
  list() {
    const ids = new Set([...Object.keys(this.records), ...this.active.keys()]);
    return { registryError: this.registryError, modules: [...ids].map(id => {
      const record = this.records[id], active = this.active.get(id)?.record;
      const runtimeFailed=active?.manifest.apiVersion===2&&!this.applications.get(id)?.isRunning();
      const usable = !!record?.enabled && record.sha256 === active?.sha256&&!runtimeFailed;
      const m = record?.manifest || active!.manifest;
      return { id, name: m.name, publisher: m.publisher, version: m.version, installed: !!record, enabled: !!record?.enabled, active: usable,
        apiVersion:m.apiVersion,application:usable&&m.apiVersion===2?{id:m.id+'.workbench',requirements:m.application.requirements}:undefined,
        restartRequired: !!record?.enabled !== !!active || (!!active && active.sha256 !== record?.sha256)||runtimeFailed, error: this.errors.get(id)||(runtimeFailed?'The module backend stopped. Saved work was retained; restart or disable the module.':undefined),
        panels: usable ? m.panels : [], browser: usable ? `/api/modules/${id}/assets/${record.sha256}/${m.browser}` : undefined,
        styles: usable ? m.styles.map(file => `/api/modules/${id}/assets/${record.sha256}/${file}`) : [],
        assets: usable ? Object.fromEntries(m.assets.map(file => [file, `/api/modules/${id}/assets/${record.sha256}/${file}`])) : {} };
    }) };
  }
  install(bytes: Buffer,preview=false) {
    if (this.registryError) throw new Error(this.registryError);
    if (bytes.length > (this.options.applications?64:6) * 1024 * 1024) throw new Error('Module package exceeds the size limit.');
    const sha256 = moduleDigest(bytes);
    // Reject unapproved bytes before inflating anything or evaluating code.
    if (!this.catalog().some(entry => entry.sha256 === sha256)) throw new Error('Package is not approved in the local trust catalog.');
    const zip = new AdmZip(bytes), entries = zip.getEntries();
    let size = 0;
    const seen = new Set<string>();
    if (entries.length > (this.options.applications?410:90)) throw new Error('Too many module package entries.');
    for (const entry of entries) {
      const mode = (entry.header.attr >>> 16) & 0xf000;
      const name = entry.isDirectory ? entry.entryName.replace(/\/$/, '') : entry.entryName;
      if (!safeModulePath(name) || seen.has(name.toLowerCase()) || mode === 0xa000 || mode && ![0x8000, 0x4000].includes(mode)) throw new Error('Unsafe or duplicate module archive path.');
      seen.add(name.toLowerCase()); size += entry.header.size;
      if (size > (this.options.applications?96:5) * 1024 * 1024) throw new Error('Expanded module package exceeds the size limit.');
    }
    const manifestEntry = zip.getEntry('module.json');
    if (!manifestEntry || manifestEntry.header.size > (this.options.applications?256:64) * 1024) throw new Error('Missing or oversized module manifest.');
    const manifest = validateModuleManifest(JSON.parse(manifestEntry.getData().toString('utf8')),this.options.applications);
    if(manifest.apiVersion===1&&manifestEntry.header.size>64*1024)throw new Error('Oversized API 1 manifest.');
    const record: Installed = { sha256, manifest, enabled: true }; this.trusted(record);
    const files = entries.filter(entry => !entry.isDirectory);
    if (files.length !== Object.keys(manifest.files).length + 1 || files.some(entry => entry.entryName !== 'module.json' && !Object.hasOwn(manifest.files, entry.entryName))) throw new Error('Unlisted module payload.');
    const payload = files.map(entry => {
      const bytes = entry.getData();
      if (bytes.length !== entry.header.size || entry.entryName !== 'module.json' && moduleDigest(bytes) !== manifest.files[entry.entryName]) throw new Error('Module file checksum mismatch.');
      return { name: entry.entryName, bytes };
    });
    const old = this.records[manifest.id];
    if (old && old.manifest.version === manifest.version && old.sha256 !== sha256) throw new Error('A different package already uses this module version.');
    if(preview)return {...this.list(),inspection:manifest};
    let replace=false;
    if (fs.existsSync(path.join(this.root, sha256))) {try{this.verify(record);}catch{replace=true;}}
    if (!fs.existsSync(path.join(this.root,sha256))||replace) {
      const staging = `staging-${randomUUID()}`;
      for (const file of payload) { const target = this.file(`${staging}/${file.name}`); fs.writeFileSync(target, file.bytes, { flag: 'wx' }); }
      fs.writeFileSync(this.file(`${staging}/package.smmodule`), bytes, { flag: 'wx' });
      const quarantine=`repair-${sha256}-${randomUUID()}`;
      if(replace)fs.renameSync(path.join(this.root,sha256),path.join(this.root,quarantine));
      try{fs.renameSync(path.join(this.root, staging), path.join(this.root, sha256));}
      catch(error){if(replace&&!fs.existsSync(path.join(this.root,sha256)))fs.renameSync(path.join(this.root,quarantine),path.join(this.root,sha256));throw error;}
    }
    this.save({ ...this.records, [manifest.id]: record });
    return this.list();
  }
  async prepareInstall(bytes:Buffer){const preview=this.install(bytes,true);if('inspection'in preview)await this.prepareChange(preview.inspection.id,'update');}
  change(id: string, action: 'disable' | 'enable' | 'remove') {
    if (!idPattern.test(id) || !Object.hasOwn(this.records, id)) throw new Error('Installed module not found.');
    const next = { ...this.records };
    if (action === 'remove') delete next[id];
    else next[id] = { ...next[id], enabled: action === 'enable' };
    this.save(next); return this.list();
  }
  async prepareChange(id:string,action:string){
    const application=this.applications.get(id);if(!application||action==='enable')return;
    const status=await application.prepareRemoval();if(status.busy)throw new Error(status.busy);
    await application.stop();this.applications.delete(id);this.active.delete(id);
  }
  forward(req:Request,res:Response){
    for(const [id,application]of this.applications){
      try{this.running(id);}catch{continue;}
      const asset=application.publicAsset(req.path);
      if(asset&&['GET','HEAD'].includes(req.method)){const record=this.active.get(id)!.record;res.sendFile(this.asset(id,record.sha256,asset.name));return true;}
      if(application.forward(req,res))return true;
    }
    return false;
  }
  async close(){this.closing=true;await Promise.all([...this.applications.values()].map(application=>application.stop()));this.applications.clear();}
  private running(id: string) {
    const active = this.active.get(id), desired = this.records[id];
    if (!active || !desired?.enabled || desired.sha256 !== active.record.sha256) throw new Error('Module is not active. Restart SwissMouse after installation or changes.');
    if(active.record.manifest.apiVersion===2&&!this.applications.get(id)?.isRunning())throw new Error('Module backend is unavailable.');
    return active;
  }
  async read(id: string, operation: string, context: PanelContext) {
    const active = this.running(id);
    if (!active.record.manifest.operations.includes(operation)) throw new Error('Unknown read operation.');
    return active.contribution.reads[operation](context);
  }
  asset(id: string, sha: string, name: string) {
    const { record } = this.running(id);
    const m = record.manifest;
    if (sha !== record.sha256 || !safeModulePath(name) || !Object.hasOwn(m.files, name) || ![m.browser, ...m.styles, ...m.assets].includes(name)) throw new Error('Module asset is unavailable.');
    const file = this.file(`${sha}/${name}`);
    if (moduleDigest(fs.readFileSync(file)) !== m.files[name]) throw new Error('Module asset failed verification.');
    return file;
  }
}

import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import AdmZip from 'adm-zip';
import { createTestFixture } from './test-fixtures.mjs';
import { buildAudiobookModule } from '../scripts/build-audiobook-module.mjs';
import { ModuleHost, moduleDigest, safeModulePath, validateModuleManifest } from './module-host';
import { WorkspacePanel } from '../src/components/WorkspacePanel';
import { Workspace } from '../src/workspace';
import { registerPanel } from '../src/workspace/panels';
import type { BrowserSdk, BrowserContribution } from '../packages/sdk';

async function fixture(t: { after: (callback: () => void) => void }) {
  const fixture = createTestFixture('.cache/module-host-'); t.after(() => fixture.cleanup());
  const saved = path.join(fixture.root, 'saved-record.json');
  fs.writeFileSync(saved, JSON.stringify({ id: 'book-1', name: 'Saved title', author: 'Saved author', metadata: { title: 'Dune', authors: ['Frank Herbert'], narrators: ['Reader'], publishedYear: '1965' } }));
  const recordBytes = fs.readFileSync(saved);
  const built = await buildAudiobookModule({ output: path.join(fixture.root, 'build') });
  const catalogFile = path.join(fixture.root, 'module-trust.json');
  const packages = [built.catalogEntry];
  const approve = (bytes: Buffer, manifest = built.manifest) => {
    packages.push({ sha256: moduleDigest(bytes), id: manifest.id, publisher: manifest.publisher, version: manifest.version });
    fs.writeFileSync(catalogFile, JSON.stringify({ schemaVersion: 1, packages }));
  };
  fs.writeFileSync(catalogFile, JSON.stringify({ schemaVersion: 1, packages }));
  const host = () => new ModuleHost({ appRoot: fixture.root, readRecord: async id => id === 'book-1' ? JSON.parse(fs.readFileSync(saved, 'utf8')) : undefined });
  return { ...fixture, built, bytes: fs.readFileSync(built.artifact), host, approve, saved, recordBytes };
}

test('install, restart, read, disable, remove and reinstall preserve saved work and stable IDs', async t => {
  const f = await fixture(t);
  let host = f.host(); await host.start();
  assert.deepEqual(host.list().modules, []);
  const pending = host.install(f.bytes).modules[0];
  assert.equal(pending.active, false); assert.equal(pending.restartRequired, true);
  await assert.rejects(host.read('audiobooks', 'audiobooks.summary', { resourceId: 'book-1' }), /not active/);
  host = f.host(); await host.start();
  assert.equal(host.list().modules[0].active, true);
  const summary = await host.read('audiobooks', 'audiobooks.summary', { resourceId: 'book-1' }) as any;
  assert.equal(summary.id, 'book-1'); assert.equal(summary.metadata.authors[0], 'Frank Herbert');
  assert.ok(!('parts' in summary)); assert.deepEqual(fs.readFileSync(f.saved), f.recordBytes);
  await assert.rejects(host.read('audiobooks', 'audiobooks.delete', {}), /Unknown/);
  await assert.rejects(host.read('audiobooks', 'audiobooks.summary', { resourceId: 'missing' }), /unavailable/);
  host.change('audiobooks', 'disable');
  await assert.rejects(host.read('audiobooks', 'audiobooks.summary', { resourceId: 'book-1' }), /not active/);
  host = f.host(); await host.start(); assert.equal(host.list().modules[0].active, false);
  host.change('audiobooks', 'remove'); host = f.host(); await host.start();
  assert.equal(host.list().modules.length, 0);
  host.install(f.bytes); host = f.host(); await host.start();
  assert.equal((await host.read('audiobooks', 'audiobooks.summary', { resourceId: 'book-1' }) as any).id, 'book-1');
  assert.deepEqual(fs.readFileSync(f.saved), f.recordBytes);
});

test('installed browser code uses the actual host React and shared panel shell; CSS and icon stay package assets', async t => {
  const f = await fixture(t); f.host().install(f.bytes);
  const host = f.host(); await host.start();
  const installed = path.join(f.root, '.installed-modules', f.built.sha256);
  const implementation = await import(pathToFileURL(path.join(installed, 'client.mjs')).href);
  const sdk: BrowserSdk = { apiVersion: 1, React, ui: { Panel: WorkspacePanel }, assetUrl: name => `/installed/${name}` };
  const contribution: BrowserContribution = implementation.activate(sdk);
  const Panel = contribution.panels['audiobooks.information'];
  const data = await host.read('audiobooks', 'audiobooks.summary', { resourceId: 'book-1' });
  const unregister = registerPanel({ id: 'audiobooks.information', name: 'Installed Book information', role: 'parent', module: 'audiobooks' });
  t.after(unregister);
  const html = renderToStaticMarkup(<Workspace page="module-proof"><Panel data={data} context={{ resourceId: 'book-1' }} /></Workspace>);
  assert.match(html, /Dune/); assert.match(html, /Frank Herbert/); assert.match(html, /workspace-panel/);
  assert.match(html, /data-desktop-window="audiobooks.information"/);
  assert.match(html, /aria-labelledby=/); assert.match(html, /src="\/installed\/book.svg"/);
  assert.match(fs.readFileSync(host.asset('audiobooks', f.built.sha256, 'panel.css'), 'utf8'), /var\(--sm-accent/);
  assert.match(fs.readFileSync(host.asset('audiobooks', f.built.sha256, 'book.svg'), 'utf8'), /<svg/);
  assert.throws(() => host.asset('audiobooks', f.built.sha256, 'backend.mjs'), /unavailable/);
  assert.throws(() => host.asset('audiobooks', f.built.sha256, 'source/client.tsx'), /unavailable/);
});

test('untrusted bytes, unsafe paths, incompatible contracts and missing inventory are rejected before execution', async t => {
  const f = await fixture(t), host = f.host();
  assert.throws(() => host.install(Buffer.from('untrusted')), /not approved/);
  const incompatible = new AdmZip(f.bytes);
  incompatible.updateFile('module.json', Buffer.from(JSON.stringify({ ...f.built.manifest, apiVersion: 999 })));
  const incompatibleBytes = incompatible.toBuffer(); f.approve(incompatibleBytes);
  assert.throws(() => host.install(incompatibleBytes), /incompatible/);
  const unsafe = new AdmZip(f.bytes); unsafe.addFile('escape.txt', Buffer.from('bad')); unsafe.getEntry('escape.txt')!.entryName = '../escape.txt';
  const unsafeBytes = unsafe.toBuffer(); f.approve(unsafeBytes);
  assert.throws(() => host.install(unsafeBytes), /Unsafe/);
  const altered = new AdmZip(f.bytes); altered.updateFile('backend.mjs', Buffer.from('throw new Error("must never execute")'));
  const alteredBytes = altered.toBuffer(); f.approve(alteredBytes);
  assert.throws(() => host.install(alteredBytes), /checksum/);
  const extra = new AdmZip(f.bytes); extra.addFile('extra.mjs', Buffer.from('export const x=1;'));
  const extraBytes = extra.toBuffer(); f.approve(extraBytes); assert.throws(() => host.install(extraBytes), /Unlisted/);
  for (const name of ['../escape', 'a/../../escape', '/absolute', 'C:/windows', 'a\\b', 'a/CON.txt']) assert.equal(safeModulePath(name), false, name);
  assert.throws(() => validateModuleManifest({ ...f.built.manifest, panels: [{ id: 'core.stolen', title: 'Bad', operation: 'audiobooks.summary' }] }), /unowned/);
  assert.deepEqual(host.list().modules, []);
});

test('corruption is preserved; safe mode skips activation and can disable a failing module', async t => {
  const f = await fixture(t); f.host().install(f.bytes);
  const badBackend = path.join(f.root, '.installed-modules', f.built.sha256, 'backend.mjs');
  const original = fs.readFileSync(badBackend); fs.writeFileSync(badBackend, 'throw new Error("not trusted")');
  let host = f.host(); await host.start();
  assert.equal(host.list().modules[0].active, false); assert.match(host.list().modules[0].error!, /verification/);
  fs.writeFileSync(badBackend, original);
  host = f.host(); await host.start(true);
  assert.equal(host.list().modules[0].active, false); assert.match(host.list().modules[0].error!, /SAFE_MODE/);
  host.change('audiobooks', 'disable');
  host = f.host(); await host.start(); assert.equal(host.list().modules[0].enabled, false);
  const registry = path.join(f.root, '.installed-modules', 'installed.json'); fs.writeFileSync(registry, '{broken');
  host = f.host(); assert.match(host.list().registryError, /needs attention/);
  assert.throws(() => host.install(f.bytes), /needs attention/); assert.equal(fs.readFileSync(registry, 'utf8'), '{broken');
});

test('updating an immutable package requires restart and retains the previous package for recovery', async t => {
  const f = await fixture(t); f.host().install(f.bytes);
  const host = f.host(); await host.start();
  const next = await buildAudiobookModule({ output: path.join(f.root, 'update'), version: '0.0.2' });
  const bytes = fs.readFileSync(next.artifact); f.approve(bytes, next.manifest);
  const updated = host.install(bytes).modules[0]; assert.equal(updated.version, '0.0.2'); assert.equal(updated.restartRequired, true); assert.equal(updated.active, false);
  assert.ok(fs.existsSync(path.join(f.root, '.installed-modules', f.built.sha256, 'backend.mjs')));
  const restarted = f.host(); await restarted.start(); assert.equal(restarted.list().modules[0].active, true);
  assert.deepEqual(fs.readFileSync(f.saved), f.recordBytes);
});

test('reported backend activation failures do not expose partial contributions or erase saved work', async t => {
  const f = await fixture(t);
  const zip = new AdmZip(f.bytes);
  const backend = Buffer.from('export function activate() { throw new Error("Reported activation failure"); }');
  const manifest = { ...f.built.manifest, files: { ...f.built.manifest.files, 'backend.mjs': moduleDigest(backend) } };
  zip.updateFile('backend.mjs', backend); zip.updateFile('module.json', Buffer.from(JSON.stringify(manifest)));
  const bytes = zip.toBuffer(); f.approve(bytes, manifest);
  f.host().install(bytes); const host = f.host(); await host.start();
  const state = host.list().modules[0]; assert.equal(state.active, false); assert.deepEqual(state.panels, []);
  assert.match(state.error!, /Reported activation failure/);
  await assert.rejects(host.read('audiobooks', 'audiobooks.summary', { resourceId: 'book-1' }), /not active/);
  host.change('audiobooks', 'disable'); assert.equal(host.list().modules[0].enabled, false);
  assert.deepEqual(fs.readFileSync(f.saved), f.recordBytes);
});

test('damaged module storage is reported without preventing the host from starting', async t => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.root, '.installed-modules'), 'preserve damaged storage');
  const host = f.host(); await host.start();
  assert.match(host.list().registryError, /needs attention/);
  assert.deepEqual(host.list().modules, []);
  assert.throws(() => host.install(f.bytes), /needs attention/);
  assert.equal(fs.readFileSync(path.join(f.root, '.installed-modules'), 'utf8'), 'preserve damaged storage');
});

test('registry manifest changes cannot bypass the original approved archive digest', async t => {
  const f = await fixture(t); f.host().install(f.bytes);
  const registry = path.join(f.root, '.installed-modules', 'installed.json');
  const state = JSON.parse(fs.readFileSync(registry, 'utf8'));
  const bytes = Buffer.from('export function activate() { throw new Error("unapproved code must not execute"); }');
  fs.writeFileSync(path.join(f.root, '.installed-modules', f.built.sha256, 'backend.mjs'), bytes);
  state.modules[0].manifest.files['backend.mjs'] = moduleDigest(bytes); fs.writeFileSync(registry, JSON.stringify(state));
  const host = f.host(); await host.start();
  assert.equal(host.list().modules[0].active, false);
  assert.match(host.list().modules[0].error!, /differs from the approved archive/);
});

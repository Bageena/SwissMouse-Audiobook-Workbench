import React from 'react';
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPreferencesRegistry, matchesPreference } from '../src/preferences/registry';
import { preferencesRegistry } from '../src/preferences/legacy';
import { activateAudiobookPreferences } from '../src/modules/audiobooks/preferences';
import { requirementDetails } from '../src/preferences/requirements';
import { PreferenceFields } from '../src/preferences/PreferenceFields';
import { ConfigModal } from '../src/components/ConfigModal';
import { RequirementsModal } from '../src/components/RequirementsModal';
import type { WorkbenchConfig } from '../src/types';
after(activateAudiobookPreferences());

test('extensions cannot overwrite another owner or duplicate a settings section', () => {
  const registry = createPreferencesRegistry();
  const section = { id: 'notes.editor', owner: 'notes', category: 'notes', title: 'Editor', description: 'Writing defaults' };
  registry.register(section);
  assert.throws(() => registry.register(section), /already registered/);
  assert.throws(() => registry.register({ ...section, id: 'core.editor' }), /namespaced/);
  section.title = 'Changed outside registry';
  assert.equal(registry.list()[0].title, 'Editor');
});

test('search finds owners and specialized controls using all search terms', () => {
  const processing = preferencesRegistry.list().find(section => section.id === 'audiobooks.processing')!;
  assert.equal(matchesPreference(processing, ' AUDIOBOOKS bitrate '), true);
  assert.equal(matchesPreference(processing, 'bitrate nonexistent'), false);
  assert.equal(matchesPreference(preferencesRegistry.list()[0], ''), true);
});

test('each supported external tool has explanatory text and secure upstream license links', () => {
  for (const id of ['python', 'ffmpeg', 'ffprobe', 'faster_whisper', 'ctranslate2', 'openai_whisper', 'pytorch', 'nvidia_acceleration', 'yt_dlp']) {
    const detail = requirementDetails[id];
    assert.ok(detail.description.length > 45, id);
    assert.ok(detail.license.length > 3, id);
    assert.equal(new URL(detail.website).protocol, 'https:');
    assert.equal(new URL(detail.licenseUrl).protocol, 'https:');
  }
  assert.match(requirementDetails.yt_dlp.license, /executable: GPLv3/);
  assert.match(requirementDetails.ffmpeg.license, /Build-dependent/);
});

test('standard contributed fields expose labels, explanations and checked state', () => {
  const html = renderToStaticMarkup(<PreferenceFields fields={[{ id: 'notes.spelling', label: 'Check spelling', description: 'Highlight possible spelling mistakes.', control: 'toggle', value: true, onChange: () => {} }]} />);
  assert.match(html, /for="preference-notes.spelling"/);
  assert.match(html, /checked=""/);
  assert.match(html, /aria-describedby="description-notes.spelling"/);
});

test('Preferences preserves the existing editors and Requirements embeds without a nested modal', () => {
  const config = { faster_transcription: true, whisper_profile: 'turbo', lead_in_seconds: 1.5, m4b_settings: { bitrate_stereo: '128k', bitrate_mono: '64k', sample_rate: 44100 } } as WorkbenchConfig;
  const html = renderToStaticMarkup(<ConfigModal presentation="preferences" config={config} theme="forest" customThemes={[]} themeWarnings={[]} isReloadingThemes={false} onThemeChange={() => {}} onReloadThemes={async () => {}} onOpenThemesFolder={async () => {}} onClose={() => {}} onSaveConfig={async () => {}} onRebuilt={async () => {}} />);
  assert.match(html, /aria-label="Preferences categories"/);
  for (const setting of ['PCM cache retention', 'Inbox folder', 'Manage Quick Tags', 'Chapter lead-in', 'Default M4B audio quality']) assert.ok(html.includes(setting), setting);
  assert.match(html, /aria-current="page"[^>]*>Appearance/);
  const embedded = renderToStaticMarkup(<RequirementsModal embedded onClose={() => {}} />);
  assert.doesNotMatch(embedded, /aria-modal/);
  assert.match(embedded, /role="region"/);
});

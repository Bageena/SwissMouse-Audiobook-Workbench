import { X } from 'lucide-react';
import { useDialogFocus } from '../utils/useDialogFocus';
import { LibraryMaintenance } from './LibraryMaintenance';
import React, { useRef, useState } from 'react';
import { WorkbenchConfig } from '../types';
import { AlertTriangle, FolderOpen, RefreshCw, Save, Settings, Sliders, Sparkles } from 'lucide-react';
import { CustomTheme, themeLabels, themes } from '../theme';
import { DEFAULT_LIBRARY_TEMPLATE, LIBRARY_FIELDS, libraryRelativePath } from '../utils/libraryPath';
import { QUICK_ADD_CATEGORIES, cleanQuickTags, normalizeQuickTag, quickTagKey } from '../utils/metadataQuickAdd';

interface ConfigModalProps {
  config: WorkbenchConfig;
  onRebuilt: () => Promise<void>;
  theme: string;
  customThemes: CustomTheme[];
  themeWarnings: string[];
  isReloadingThemes: boolean;
  onThemeChange: (theme: string) => void;
  onReloadThemes: () => Promise<void>;
  onOpenThemesFolder: () => Promise<void>;
  onClose: () => void;
  onSaveConfig: (newConfig: WorkbenchConfig) => Promise<void>;
}

export const ConfigModal: React.FC<ConfigModalProps> = ({ config, theme, customThemes, themeWarnings, isReloadingThemes, onThemeChange, onReloadThemes, onOpenThemesFolder, onClose, onSaveConfig, onRebuilt }) => {
  const [form, setForm] = useState<WorkbenchConfig>({ ...config });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const dismiss = () => {
    if (isSaving) return;
    if (JSON.stringify(form) !== JSON.stringify(config) && !window.confirm('Discard your unsaved settings changes?')) return;
    onClose();
  };
  const dialogRef = useDialogFocus(dismiss);
  const [themeActionError, setThemeActionError] = useState('');
  const [quickTagSearch, setQuickTagSearch] = useState('');
  const [quickTagInput, setQuickTagInput] = useState('');
  const [editingQuickTag, setEditingQuickTag] = useState<string | null>(null);
  const quickTags = form.quick_tags || [...QUICK_ADD_CATEGORIES];
  const addQuickTag = () => {
    const value = normalizeQuickTag(quickTagInput);
    if (!value) return;
    setForm({ ...form, quick_tags: cleanQuickTags([...quickTags, value]) });
    setQuickTagInput('');
  };
  const renameQuickTag = (oldValue: string, newValue: string) => {
    const value = normalizeQuickTag(newValue);
    if (!value || (quickTags.some(tag => tag !== oldValue && quickTagKey(tag) === quickTagKey(value)))) return;
    setForm({ ...form, quick_tags: quickTags.map(tag => tag === oldValue ? value : tag) });
    setEditingQuickTag(null);
  };
  const templateInput = useRef<HTMLInputElement>(null);
  const insertField = (field: string) => {
    const input = templateInput.current;
    const template = form.library_template ?? DEFAULT_LIBRARY_TEMPLATE;
    const start = input?.selectionStart ?? template.length;
    const end = input?.selectionEnd ?? template.length;
    setForm({ ...form, library_template: template.slice(0, start) + `%${field}%` + template.slice(end) });
    requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + field.length + 2, start + field.length + 2); });
  };
  let folderPreview = '';
  try { folderPreview = libraryRelativePath(form.library_template ?? DEFAULT_LIBRARY_TEMPLATE, { title: 'Hitchhikers Guide to the Galaxy', author: 'Douglas Adams', narrator: 'Douglas Adams', series: "Hitchhiker's Guide to the Galaxy", seriesSequence: '1', genres: [], language: 'eng', abridged: false, explicit: false }).join(' / '); }
  catch { folderPreview = 'Check the folder pattern.'; }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError('');
    setIsSaving(true);
    try {
      await onSaveConfig(form);
      onClose();
    } catch (err: any) {
      setSaveError(err.message || 'Could not save settings. Your changes are still here; try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1} className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-stone-200 bg-white p-6 shadow-xl space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-stone-900 font-bold text-base">
            <Settings className="w-5 h-5 text-amber-600" />
            <span>Settings</span>
          </div>
          <button
            onClick={dismiss}
            disabled={isSaving}
            aria-label="Close settings"
            className="text-stone-400 hover:text-stone-600 text-lg cursor-pointer"
          ><X className="h-4 w-4" aria-hidden="true" /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {saveError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{saveError}</p>}
          <fieldset className="space-y-3 rounded-lg border border-stone-200 bg-stone-50 p-3.5">
            <legend className="px-1 text-xs font-semibold text-stone-900">Audiobook library</legend>
            <p className="text-[11px] text-stone-600">Inbox holds books in progress. Library holds organized books. New standalone projects use Library as their output folder.</p>
            <label className="block font-semibold text-stone-800" htmlFor="inbox-folder">Inbox folder</label>
            <div className="flex gap-2">
              <input id="inbox-folder" type="text" value={form.inbox_folder || ''} onChange={event => setForm({ ...form, inbox_folder: event.target.value })} placeholder="Full folder path" className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-2.5 py-2 font-mono text-xs text-stone-900" />
              <button type="button" onClick={() => setForm({ ...form, inbox_folder: '' })} className="rounded border border-stone-300 bg-white px-2 font-semibold text-stone-700">Use default</button>
            </div>
            <p className="text-[11px] text-stone-500">Clear to use SwissMouse’s inbox folder. Inbox and Library cannot overlap. Changing a setting does not move existing books.</p>
            <label className="flex items-start gap-2 text-xs text-stone-800"><input type="checkbox" checked={!!form.audiobookshelf_metadata} onChange={event => setForm({ ...form, audiobookshelf_metadata:event.target.checked })} /><span><strong>Write Audiobookshelf metadata.json</strong><span className="block text-stone-500">Save an additional compatibility file beside media. SwissMouse always saves exmetadata.json. Turning this off leaves existing files untouched.</span></span></label>
            <label className="flex items-start gap-2 text-xs text-stone-800"><input type="checkbox" checked={form.save_cover_beside_audio !== false} onChange={event => setForm({ ...form, save_cover_beside_audio: event.target.checked })} /><span><strong>Save cover beside audiobook</strong><span className="block text-stone-500">Save cover.jpg or cover.png alongside converted audio. Embedded artwork is kept where supported. Turning this off leaves existing cover files untouched.</span></span></label>
            <label className="block font-semibold text-stone-800" htmlFor="library-folder">Library folder</label>
            <div className="flex gap-2">
              <input id="library-folder" type="text" value={form.library_folder || ''} onChange={event => setForm({ ...form, library_folder: event.target.value })} placeholder="Full folder path" className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-2.5 py-2 font-mono text-xs text-stone-900" />
              <button type="button" onClick={() => setForm({ ...form, library_folder: '' })} className="rounded border border-stone-300 bg-white px-2 font-semibold text-stone-700">Use default</button>
            </div>
            <p className="text-[11px] text-stone-500">The folder is created when you save settings. Clear it to use SwissMouse’s output folder.</p>
            <label className="block font-semibold text-stone-800" htmlFor="library-template">Folder structure</label>
            <input ref={templateInput} id="library-template" type="text" value={form.library_template ?? DEFAULT_LIBRARY_TEMPLATE} onChange={event => setForm({ ...form, library_template: event.target.value })} className="w-full rounded border border-stone-300 bg-white px-2.5 py-2 font-mono text-xs text-stone-900" />
            <div className="flex flex-wrap gap-1.5">{LIBRARY_FIELDS.map(field => <button key={field} type="button" onClick={() => insertField(field)} className="rounded border border-stone-300 bg-white px-2 py-1 font-mono text-[11px] text-stone-700 hover:bg-amber-50">%{field}%</button>)}</div>
            <button type="button" onClick={() => setForm({ ...form, library_template: DEFAULT_LIBRARY_TEMPLATE })} className="font-semibold text-amber-800 underline">Reset folder structure</button>
            <p className="break-words rounded bg-white p-2 text-[11px] text-stone-600">Example: {folderPreview}</p>
            <p className="text-[11px] text-stone-500">Use / between folders. Subtitle is available as an optional tag and is left out by default. Missing series and narrator fields are skipped.</p>
          </fieldset>
          <fieldset className="space-y-2 rounded-lg border border-stone-200 bg-stone-50 p-3.5">
            <legend className="px-1 text-xs font-semibold text-stone-900">Manage Quick Tags</legend>
            <p className="text-[11px] text-stone-600">These suggestions appear in Quick Add and Add Tag. Editing or deleting a suggestion does not change existing books.</p>
            <input type="search" value={quickTagSearch} onChange={event => setQuickTagSearch(event.target.value)} placeholder="Search Quick Tags" aria-label="Search Quick Tags" className="w-full rounded border border-stone-300 bg-white px-2.5 py-2" />
            <div className="flex gap-2"><input value={quickTagInput} onChange={event => setQuickTagInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addQuickTag(); } }} placeholder="New Quick Tag" aria-label="New Quick Tag" className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-2.5 py-2" /><button type="button" onClick={addQuickTag} className="rounded border border-stone-300 bg-white px-3 font-semibold">+ Add</button></div>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded border border-stone-200 bg-white p-2">
              {[...quickTags].sort((a, b) => a.localeCompare(b)).filter(tag => quickTagKey(tag).includes(quickTagKey(quickTagSearch))).map(tag => <div key={tag} className="flex items-center gap-2 text-stone-800">
                {editingQuickTag === tag ? <input autoFocus defaultValue={tag} aria-label={`Rename ${tag}`} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); renameQuickTag(tag, event.currentTarget.value); } if (event.key === 'Escape') { event.preventDefault(); setEditingQuickTag(null); } }} onBlur={event => renameQuickTag(tag, event.target.value)} className="min-w-0 flex-1 rounded border border-stone-300 px-2 py-1" /> : <span className="min-w-0 flex-1 truncate">{tag}</span>}
                <button type="button" onClick={() => setEditingQuickTag(tag)} aria-label={`Edit ${tag}`} className="font-semibold text-amber-800">Edit</button>
                <button type="button" onClick={() => { setForm({ ...form, quick_tags: quickTags.filter(item => item !== tag) }); setEditingQuickTag(null); }} aria-label={`Delete ${tag}`} className="font-semibold text-rose-700">Delete</button>
              </div>)}
            </div>
          </fieldset>
          <fieldset className="space-y-2 rounded-lg border border-stone-200 bg-stone-50 p-3.5">
            <legend className="px-1 text-xs font-semibold text-stone-900">Processing storage</legend>
            <label htmlFor="pcm-retention" className="block font-semibold text-stone-800">PCM cache retention</label>
            <select id="pcm-retention" value={form.pcm_retention || 'after_verified_export'} onChange={event => setForm({ ...form, pcm_retention: event.target.value as WorkbenchConfig['pcm_retention'] })} className="w-full rounded border border-stone-300 bg-white px-2.5 py-2 text-xs text-stone-900">
              <option value="after_verified_export">Delete PCM after verified export</option>
              <option value="until_finalized">Keep PCM until final check passes</option>
              <option value="keep">Keep PCM indefinitely</option>
            </select>
            <p className="text-[11px] text-stone-600">Only SwissMouse PCM in this book’s processing workspace is removed. Transcripts, chapter work, source audio, and final exports remain.</p>
          </fieldset>
          <fieldset className="theme-picker space-y-2 rounded-lg border border-stone-200 bg-stone-50 p-3.5">
            <legend className="px-1 text-xs font-semibold text-stone-900">Appearance / Theme</legend>
            <p className="text-[11px] text-stone-500">Choose a comfortable palette. Your choice is saved automatically and shared across windows using this SwissMouse installation.</p>
            <p className="pt-1 text-[10px] font-bold uppercase tracking-wider text-stone-500">Built-in</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {themes.map((option) => (
                <label
                  key={option}
                  className={`theme-option flex cursor-pointer items-center gap-2 rounded-lg border p-2 transition-colors ${theme === option ? 'is-selected border-amber-500 bg-amber-50 text-stone-900' : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-100'}`}
                >
                  <input
                    type="radio"
                    name="appearance-theme"
                    value={option}
                    checked={theme === option}
                    onChange={() => onThemeChange(option)}
                    className="sr-only"
                  />
                  <span className={`theme-swatch theme-swatch-${option}`} aria-hidden="true"><span /></span>
                  <span className="font-semibold">{themeLabels[option]}</span>
                  <span className="sr-only">{theme === option ? ' selected' : ''}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between pt-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Custom</p>
              <span className="text-[10px] text-stone-500">{customThemes.length} available</span>
            </div>
            {customThemes.length > 0 ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {customThemes.map((option) => (
                  <label
                    key={option.id}
                    title={`${option.description || option.name} · Inherits ${themeLabels[option.extends]}`}
                    className={`theme-option flex cursor-pointer items-center gap-2 rounded-lg border p-2 transition-colors ${theme === option.id ? 'is-selected border-amber-500 bg-amber-50 text-stone-900' : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-100'}`}
                  >
                    <input type="radio" name="appearance-theme" value={option.id} checked={theme === option.id} onChange={() => onThemeChange(option.id)} className="sr-only" />
                    <span className="theme-swatch theme-swatch-custom" aria-hidden="true"><span /></span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{option.name}</span>
                      <span className="block text-[9px] text-stone-500">Based on {themeLabels[option.extends]}</span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="rounded border border-dashed border-stone-300 bg-white p-2 text-[11px] text-stone-500">No custom themes found. Copy the <code>_template</code> folder to get started.</p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" onClick={async () => { setThemeActionError(''); try { await onOpenThemesFolder(); } catch (error) { setThemeActionError(error instanceof Error ? error.message : 'Could not open themes folder.'); } }} className="inline-flex items-center gap-1.5 rounded border border-stone-300 bg-white px-2.5 py-1.5 font-semibold text-stone-700 hover:bg-stone-100">
                <FolderOpen className="h-3.5 w-3.5" /> Open Themes Folder
              </button>
              <button type="button" disabled={isReloadingThemes} onClick={() => { setThemeActionError(''); void onReloadThemes(); }} className="inline-flex items-center gap-1.5 rounded border border-stone-300 bg-white px-2.5 py-1.5 font-semibold text-stone-700 hover:bg-stone-100 disabled:opacity-50">
                <RefreshCw className={`h-3.5 w-3.5 ${isReloadingThemes ? 'animate-spin' : ''}`} /> {isReloadingThemes ? 'Reloading…' : 'Reload Themes'}
              </button>
            </div>
            {(themeActionError || themeWarnings.length > 0) && (
              <div role="status" className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div><p className="font-semibold">Appearance needs attention.</p>{themeActionError && <p>{themeActionError}</p>}{themeWarnings.map(warning => <p key={warning}>{warning}</p>)}</div>
              </div>
            )}
          </fieldset>
          <div className="p-3.5 bg-emerald-50 rounded-lg border border-emerald-200 space-y-1.5">
            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <span>
                <span className="block font-semibold text-stone-900">Faster Transcription</span>
                <span className="block text-[11px] text-stone-600 mt-1">Uses the optimized Faster Whisper engine for faster processing and lower memory usage. Recommended for most systems.</span>
              </span>
              <input
                type="checkbox"
                checked={form.faster_transcription}
                onChange={(event) => setForm({ ...form, faster_transcription: event.target.checked })}
                title="Runs your selected Whisper model using the optimized CTranslate2 engine. Disable this if you experience compatibility problems."
                className="w-5 h-5 accent-emerald-600 shrink-0"
              />
            </label>
            <p className="text-[10px] text-stone-500">{form.faster_transcription ? 'Active engine: Faster Whisper (recommended)' : 'Active engine: OpenAI Whisper compatibility mode'}</p>
          </div>
          {/* Whisper Profile */}
          <div className="space-y-1.5">
            <label className="font-semibold text-stone-800 flex items-center space-x-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              <span>Default speech-recognition profile</span>
            </label>
            <select
              value={form.whisper_profile}
              onChange={(e) =>
                setForm({
                  ...form,
                  whisper_profile: e.target.value as 'turbo' | 'accurate' | 'cpu',
                })
              }
              className="w-full px-3 py-2 border border-stone-300 rounded-lg bg-stone-50 font-medium text-stone-900"
            >
              <option value="turbo">turbo (large-v3-turbo, float16 GPU, fast & default)</option>
              <option value="accurate">accurate (large-v3, high accuracy large model)</option>
              <option value="cpu">cpu (medium.en, int8 quantization for CPU systems)</option>
            </select>
            <p className="text-[11px] text-stone-500">This is the default used when a project does not choose its own model. Faster options trade some accuracy for speed.</p>
          </div>

          {/* Lead-in seconds */}
          <div className="space-y-1.5">
            <label className="font-semibold text-stone-800 flex items-center justify-between">
              <span>Chapter lead-in (seconds)</span>
              <span className="font-mono text-amber-700 font-bold">{form.lead_in_seconds}s</span>
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="5"
              value={form.lead_in_seconds}
              onChange={(e) => {
                const value = Number.parseFloat(e.target.value);
                setForm({ ...form, lead_in_seconds: Number.isFinite(value) ? value : 1.5 });
              }}
              className="w-full px-3 py-2 border border-stone-300 rounded-lg bg-stone-50 font-mono text-stone-900"
            />
            <p className="text-[11px] text-stone-500">
              Starts AI-detected chapters slightly before the first spoken word (default: 1.5 seconds), so the beginning is not clipped.
            </p>
          </div>

          {/* M4B Encoding Settings */}
          <div className="p-3.5 bg-stone-50 rounded-lg border border-stone-200 space-y-3">
            <div className="font-semibold text-stone-800 flex items-center space-x-1.5">
              <Sliders className="w-3.5 h-3.5 text-stone-600" />
              <span>Default M4B audio quality</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label title="Bitrate controls file size when audio is re-encoded; it cannot improve the source recording." className="text-[11px] text-stone-500 block mb-1">Stereo quality (bitrate)</label>
                <input
                  type="text"
                  value={form.m4b_settings.bitrate_stereo}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      m4b_settings: { ...form.m4b_settings, bitrate_stereo: e.target.value },
                    })
                  }
                  className="w-full px-2.5 py-1.5 border border-stone-300 rounded font-mono text-xs bg-white text-stone-900"
                />
              </div>

              <div>
                <label title="Bitrate controls file size when audio is re-encoded; it cannot improve the source recording." className="text-[11px] text-stone-500 block mb-1">Mono quality (bitrate)</label>
                <input
                  type="text"
                  value={form.m4b_settings.bitrate_mono}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      m4b_settings: { ...form.m4b_settings, bitrate_mono: e.target.value },
                    })
                  }
                  className="w-full px-2.5 py-1.5 border border-stone-300 rounded font-mono text-xs bg-white text-stone-900"
                />
              </div>
            </div>

            <div className="flex justify-between items-center text-[11px] text-stone-600 pt-1">
              <span>Sample Rate:</span>
              <span className="font-mono font-semibold">{form.m4b_settings.sample_rate} Hz</span>
            </div>
          </div>

          <LibraryMaintenance pathsChanged={form.inbox_folder !== config.inbox_folder || form.library_folder !== config.library_folder} onRebuilt={onRebuilt} />
          <div className="flex justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={dismiss}
              disabled={isSaving}
              className="px-3 py-1.5 rounded text-xs border border-stone-300 text-stone-700 hover:bg-stone-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center space-x-1.5 px-4 py-1.5 rounded text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Saving...' : 'Save Settings'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

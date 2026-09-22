import React, { useState } from 'react';
import { WorkbenchConfig } from '../types';
import { AlertTriangle, FolderOpen, RefreshCw, Save, Settings, Sliders, Sparkles } from 'lucide-react';
import { CustomTheme, themeLabels, themes } from '../theme';

interface ConfigModalProps {
  config: WorkbenchConfig;
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

export const ConfigModal: React.FC<ConfigModalProps> = ({ config, theme, customThemes, themeWarnings, isReloadingThemes, onThemeChange, onReloadThemes, onOpenThemesFolder, onClose, onSaveConfig }) => {
  const [form, setForm] = useState<WorkbenchConfig>({ ...config });
  const [isSaving, setIsSaving] = useState(false);
  const [themeActionError, setThemeActionError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSaveConfig(form);
      onClose();
    } catch (err: any) {
      alert(err.message || 'Failed to update config');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-stone-200 bg-white p-6 shadow-xl space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-stone-900 font-bold text-base">
            <Settings className="w-5 h-5 text-amber-600" />
            <span>Settings</span>
          </div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600 text-lg cursor-pointer"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <fieldset className="theme-picker space-y-2 rounded-lg border border-stone-200 bg-stone-50 p-3.5">
            <legend className="px-1 text-xs font-semibold text-stone-900">Appearance / Theme</legend>
            <p className="text-[11px] text-stone-500">Choose a comfortable palette. Your choice is saved automatically for the next time SwissMouse opens.</p>
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
                <div><p className="font-semibold">Some custom themes could not be loaded.</p>{themeActionError && <p>{themeActionError}</p>}{themeWarnings.map(warning => <p key={warning}>{warning}</p>)}</div>
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

          <div className="flex justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={onClose}
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

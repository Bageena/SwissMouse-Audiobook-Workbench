import { useEffect, useState } from 'react';
import { FolderCheck, FolderOpen, FolderEdit, RotateCcw, ChevronDown, AlertCircle } from 'lucide-react';
import { DesktopWindow } from './DesktopWorkspace';
import { DEFAULT_LIBRARY_TEMPLATE, finalOutputRoot, libraryLocationPreview } from '../utils/libraryPath';
import type { AudiobookJob, WorkbenchConfig } from '../types';

export function OutputFolder({ job, config, onUpdateJobSettings }: {
  job: AudiobookJob;
  config: WorkbenchConfig;
  onUpdateJobSettings: (updates: Partial<AudiobookJob>) => Promise<void>;
}) {
  const [outputFolderPath, setOutputFolderPath] = useState<string>(
    finalOutputRoot(job.outputFolderPath, config.library_folder || 'output')
  );
  const [defaultOutputFolder, setDefaultOutputFolder] = useState<string>('output');
  const [outputFolderError, setOutputFolderError] = useState<string | null>(null);
  const [showOutputInput, setShowOutputInput] = useState<boolean>(false);
  const [customOutputInput, setCustomOutputInput] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/system/output-folder').then(async response => {
      if (!response.ok) throw new Error('Could not load the output folder.');
      const data = await response.json();
      if (cancelled) return;
      setOutputFolderPath(finalOutputRoot(job.outputFolderPath, data.outputFolder));
      setDefaultOutputFolder(data.defaultOutputFolder);
    }).catch(error => { if (!cancelled) setOutputFolderError(error.message); });
    return () => { cancelled = true; };
  }, [job.id, job.outputFolderPath]);
  const handleOpenNativeOutputFolderPicker = async () => {
    // Browser directory handles expose only a folder name, not its absolute disk path.
    setShowOutputInput(true);
    setCustomOutputInput(outputFolderPath);
    setOutputFolderError('Paste the full output folder path. Browser folder selection cannot provide its disk location.');
  };

  const handleSetOutputFolder = async (newPath: string) => {
    setOutputFolderError(null);
    try {
      const res = await fetch('/api/system/output-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputFolder: newPath }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'The selected output folder cannot be written to.');
      }
      setOutputFolderPath(data.outputFolder);
      setShowOutputInput(false);
      await onUpdateJobSettings({ outputFolderPath: data.outputFolder });
    } catch (err: any) {
      setOutputFolderError(err.message);
    }
  };

  const handleResetDefaultOutput = () => handleSetOutputFolder(defaultOutputFolder);

  return (
      <DesktopWindow id="processing-output" title="Output"><details className="workspace-panel advanced-disclosure rounded-xl border border-stone-200/80 bg-white shadow-xs">
        <summary className="output-folder-header workspace-panel-header workspace-toolbar flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
          <span className="flex min-w-0 items-center gap-3">
            <span className="min-w-0"><span className="workspace-panel-title inline-block text-sm font-bold text-stone-900">Output</span></span>
          </span>
          <span className="ml-auto flex shrink-0 items-center text-stone-500"><ChevronDown aria-hidden="true" className="disclosure-chevron h-4 w-4" /></span>
        </summary>
        <div className="space-y-4 border-t border-stone-100 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-100 pb-3">
          <div className="flex items-center space-x-2">
            <FolderCheck className="w-5 h-5 text-amber-600" />
            <div>
              <h3 className="font-bold text-sm text-stone-900">Output folder</h3>
              <p className="text-xs text-stone-500">
                Finished audiobooks are saved here using your library folder pattern.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 flex-wrap gap-y-2">
            <button
              id="btn-choose-output-folder"
              onClick={handleOpenNativeOutputFolderPicker}
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white shadow-xs transition-colors cursor-pointer flex items-center space-x-1.5"
              title="Open native file explorer to choose an output location"
            >
              <FolderOpen className="w-4 h-4" />
              <span>Choose Output Folder</span>
            </button>

            <button
              id="btn-toggle-output-path"
              onClick={() => setShowOutputInput(!showOutputInput)}
              className="px-3 py-2 rounded-lg text-xs font-medium bg-white hover:bg-stone-100 text-stone-700 border border-stone-200 transition-colors cursor-pointer flex items-center space-x-1.5"
              title="Type or paste a custom directory path"
            >
              <FolderEdit className="w-3.5 h-3.5 text-stone-500" />
              <span>{showOutputInput ? 'Hide Path Input' : 'Enter Path'}</span>
            </button>

            <button
              id="btn-reset-default-output"
              onClick={handleResetDefaultOutput}
              className="px-3 py-2 rounded-lg text-xs font-medium bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-200 transition-colors cursor-pointer flex items-center space-x-1.5"
              title="Reset output destination to the library folder in Settings"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset to Default</span>
            </button>
          </div>
        </div>

        {/* Selected Output Path Display */}
        <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="space-y-0.5 min-w-0">
            <span className="text-stone-500 font-medium">Selected Output Location Format</span>
            <div className="font-mono font-bold text-stone-900 break-words [overflow-wrap:anywhere]" title="Update the metadata below to fill in this format. Unfilled placeholders such as %Series% are omitted when saving; no folder is created for a missing value.">
              {libraryLocationPreview(outputFolderPath, config.library_template || DEFAULT_LIBRARY_TEMPLATE, { ...job.metadata, ...job.metadataDraft })}
            </div>
          </div>
        </div>

        {/* Optional Custom Output Path Input */}
        {showOutputInput && (
          <div className="p-3.5 bg-stone-50 rounded-lg border border-stone-200 space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-stone-700">Enter Local Output Directory Path:</span>
              <span className="text-[11px] text-stone-500">Auto-created if it does not yet exist</span>
            </div>
            <div className="flex items-center space-x-2">
              <input
                id="custom-output-path-input"
                type="text"
                value={customOutputInput}
                onChange={(e) => setCustomOutputInput(e.target.value)}
                placeholder="e.g. output or /home/user/Audiobooks/output or C:\Audiobooks\Output"
                className="flex-1 px-3 py-2 bg-white border border-stone-300 rounded-md font-mono text-stone-800 focus:outline-hidden focus:ring-1 focus:ring-amber-500 text-xs"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customOutputInput.trim()) {
                    handleSetOutputFolder(customOutputInput.trim());
                  }
                }}
              />
              <button
                id="btn-set-custom-output-folder"
                onClick={() => handleSetOutputFolder(customOutputInput.trim())}
                disabled={!customOutputInput.trim()}
                className="px-3.5 py-2 bg-stone-900 text-white rounded-md font-semibold hover:bg-stone-800 disabled:opacity-50 cursor-pointer text-xs shrink-0"
              >
                Set Output Folder
              </button>
            </div>
            <div className="flex items-center space-x-2 text-stone-500 text-[11px]">
              <span>Quick paths:</span>
              <button
                type="button"
                onClick={() => {
                  setCustomOutputInput('output');
                  handleSetOutputFolder('output');
                }}
                className="underline hover:text-amber-800 cursor-pointer"
              >
                output
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={() => {
                  setCustomOutputInput('output/audiobooks');
                  handleSetOutputFolder('output/audiobooks');
                }}
                className="underline hover:text-amber-800 cursor-pointer"
              >
                output/audiobooks
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={() => {
                  setCustomOutputInput('audiobooks/exports');
                  handleSetOutputFolder('audiobooks/exports');
                }}
                className="underline hover:text-amber-800 cursor-pointer"
              >
                audiobooks/exports
              </button>
            </div>
          </div>
        )}

        {/* Inline Output Validation Error */}
        {outputFolderError && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span className="font-medium">{outputFolderError}</span>
          </div>
        )}
        </div>
      </details></DesktopWindow>
  );
}

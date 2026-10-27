import React, { useEffect, useId, useRef, useState } from 'react';

export type LibraryTransferMode = 'copy' | 'move';

export const MoveToLibraryDialog: React.FC<{
  jobId?: string; name: string; busy: boolean; error: string; unchecked?: boolean;
  onChoose: (mode: LibraryTransferMode) => void; onCancel: () => void;
}> = ({ jobId, name, busy, error, unchecked, onChoose, onCancel }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId(), description = useId();
  const [mode, setMode] = useState<LibraryTransferMode>('move');
  const [preview, setPreview] = useState<{ destination: string; files: string[]; kept: string[]; conflict: boolean; keptOverview?: boolean }>();
  const [previewError, setPreviewError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    void fetch(`/api/jobs/${encodeURIComponent(jobId)}/move-to-library`, { signal: controller.signal }).then(async response => {
      const result = await response.json(); if (!response.ok) throw new Error(result.error); setPreview(result);
    }).catch(error => { if (!controller.signal.aborted) setPreviewError(error.message); });
    return () => controller.abort();
  }, [jobId]);
  const blocked = busy || (!!jobId && (!preview || preview.conflict));
  return <dialog ref={dialog} aria-labelledby={title} aria-describedby={description}
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}
    className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-2xl border border-stone-200 bg-white p-6 text-stone-900 shadow-xl backdrop:bg-black/40">
    <h3 id={title} className="text-lg font-bold">Move to Library</h3>
    <p id={description} className="mt-2 text-sm text-stone-600">Choose how to finish “{name}”. Files are verified before any originals are removed.</p>
    {unchecked && <p className="mt-2 text-sm text-amber-800">The final check has not passed. You can transfer this project now and run the check later.</p>}
    {preview && <div className="mt-3 text-xs text-stone-700"><p className="break-all">Destination: {preview.destination}</p><p className="mt-1">{preview.files.length} associated files. Saved metadata and the selected cover are included.</p><details className="mt-2"><summary>Files to transfer</summary><ul className="max-h-32 overflow-auto">{preview.files.map(file => <li key={file} className="break-all">{file}</li>)}</ul></details><details className="mt-2"><summary>{preview.keptOverview ? 'Other files and folders kept in place' : `Files kept in place (${preview.kept.length})`}</summary><ul className="max-h-32 overflow-auto">{preview.kept.map(file => <li key={file} className="break-all">{file}</li>)}</ul></details>{preview.keptOverview && <p className="mt-2">Only listed transfer files are moved. Other folder contents stay in place.</p>}{preview.conflict && <p role="alert" className="mt-2 text-red-700">Destination already exists. Choose a different book folder before transferring.</p>}</div>}
    {jobId && !preview && !previewError && <p role="status" className="mt-2 text-xs">Checking associated files…</p>}
    {previewError && <p role="alert" className="mt-2 text-sm text-red-700">{previewError}</p>}
    <div className="mt-5 space-y-3">
      <label className="block rounded-xl border border-amber-400 p-4 text-left hover:bg-amber-50">
        <span className="block font-semibold"><input type="radio" name={title + '-mode'} checked={mode === 'move'} disabled={busy} onChange={() => setMode('move')} className="mr-2" />Move &amp; Clean Up</span>
        <span className="mt-1 block text-sm text-stone-600">Copy the project to your Library, then remove its original files after verification. Shared files stay; empty source folders are removed.</span>
      </label>
      <label className="block rounded-xl border border-stone-300 p-4 text-left hover:bg-stone-50">
        <span className="block font-semibold"><input type="radio" name={title + '-mode'} checked={mode === 'copy'} disabled={busy} onChange={() => setMode('copy')} className="mr-2" />Copy &amp; Keep</span>
        <span className="mt-1 block text-sm text-stone-600">Copy the project to your Library and keep the original source files.</span>
      </label>
    </div>
    {busy && <p role="status" className="mt-3 text-sm">Transferring and verifying files…</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    <button type="button" disabled={blocked} onClick={() => onChoose(mode)} className="mr-3 mt-4 rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{mode === 'move' ? 'Move to Library' : 'Copy to Library'}</button>
    <button type="button" disabled={busy} onClick={onCancel} className="mt-4 rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">Cancel</button>
  </dialog>;
};

export const MoveToLibrary: React.FC<{
  jobId?: string; name: string; eligible: boolean; disabled?: boolean; onTransfer: (mode: LibraryTransferMode) => Promise<string | undefined>;
}> = ({ jobId, name, eligible, disabled, onTransfer }) => {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const transfer = async (mode: LibraryTransferMode) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const warning = await onTransfer(mode);
      setMessage(warning || (mode === 'copy' ? 'Copied to Library. Original files kept.' : 'Moved to Library. Files verified and source cleanup completed.'));
      setOpen(false);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not transfer the project.'); }
    finally { setBusy(false); }
  };
  return <>
    <button type="button" disabled={!eligible || disabled || busy} title={eligible ? 'Transfer this project to your Library' : 'Pass the final check to move this project. Library Manager also allows transfer before checking.'} onClick={() => { setError(''); setOpen(true); }} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 disabled:opacity-40">Move to Library</button>
    {open && <MoveToLibraryDialog jobId={jobId} name={name} busy={busy} error={error} onChoose={mode => void transfer(mode)} onCancel={() => setOpen(false)} />}
    {message && <p role="status" className="mt-3 text-sm text-stone-700">{message}</p>}
  </>;
};

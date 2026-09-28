import React, { useState } from 'react';
import { CheckCircle2, FileCheck2, FolderOpen, Loader2, ShieldCheck } from 'lucide-react';
import { AudiobookJob } from '../types';
import { useDependencyStatus } from '../dependency-status';
export const Step5Validate: React.FC<{job:AudiobookJob;onValidate:()=>Promise<void>;isValidating:boolean}> = ({job,onValidate,isValidating}) => {
  const validationAvailability = useDependencyStatus().feature('output_validation');
  const [isOpeningFolder, setIsOpeningFolder] = useState(false);
  const [folderError, setFolderError] = useState('');
  const openContainingFolder = async () => {
    setIsOpeningFolder(true);
    setFolderError('');
    try {
      const response = await fetch(`/api/jobs/${job.id}/export/open-folder`, { method: 'POST' });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Could not open the export folder.');
      }
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : 'Could not open the export folder.');
    } finally { setIsOpeningFolder(false); }
  };
  return <section className="space-y-5 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
    <div className="flex items-start gap-3 border-b border-stone-100 pb-5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><ShieldCheck className="h-5 w-5" /></div>
      <div><h2 className="text-xl font-bold tracking-tight text-stone-950">One final check</h2><p className="mt-1 max-w-2xl text-sm leading-relaxed text-stone-600">SwissMouse compares the newest file with your saved chapter list. Afterward, play a few chapters in your favorite app to confirm navigation.</p></div>
    </div>
    <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-700 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-amber-800 disabled:bg-stone-300 disabled:text-stone-500" title={validationAvailability.tooltip || 'Read the exported file and compare its chapters with the saved list'} disabled={!validationAvailability.ready || isValidating || !job.outputM4b} onClick={onValidate}>{isValidating ? <><Loader2 className="h-4 w-4 animate-spin" />Checking audiobook…</> : <><FileCheck2 className="h-4 w-4" />Check audiobook</>}</button>
    {job.validation && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" /><div><strong className="block text-sm text-emerald-950">{job.validation.status}: {job.validation.file}</strong><p className="mt-1 text-xs text-emerald-900">{job.validation.chapters_count} chapters · {Math.round(job.validation.duration_seconds / 60)} minutes · {job.validation.size_mb} MB</p><p className="mt-2 text-xs text-stone-600">{job.validation.reason}</p></div></div>
      {job.outputM4b && <div className="mt-4 space-y-2"><button type="button" onClick={openContainingFolder} disabled={isOpeningFolder} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-300 bg-white px-3 text-sm font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-60"><FolderOpen className="h-4 w-4" />{isOpeningFolder ? 'Opening folder…' : 'Open containing folder'}</button>{folderError && <p role="alert" className="text-xs font-medium text-red-700">{folderError}</p>}</div>}
    </div>}
  </section>;
};

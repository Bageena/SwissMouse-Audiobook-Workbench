import { OutputFolder } from './OutputFolder';
import { ProjectOverview } from './ProjectOverview';
import { ResizableRegion } from './ResizableRegion';
import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { AudiobookJob, WorkbenchConfig } from '../types';
import { AddFiles } from './AddFiles';
import { SourceFileBrowser } from './SourceFileBrowser';
import { WorkspacePanel, WorkspaceSplit } from './WorkspacePanel';
import { ProcessingOrder, type QueueReadiness } from './ProcessingOrder';

export function BookFiles({ job, config, onImported, onChanged, onContinue, onUpdateJobSettings, children }: {
  job: AudiobookJob; config: WorkbenchConfig; children?: React.ReactNode;
  onImported: (job?: AudiobookJob) => Promise<void>; onChanged: (job: AudiobookJob) => Promise<void>;
  onContinue: () => Promise<void>;
  onUpdateJobSettings: (updates: Partial<AudiobookJob>) => Promise<void>;
}) {
  const [readiness, setReadiness] = useState<QueueReadiness>({ status: job.parts.length ? 'Checking' : 'Empty', issues: [], durationSeconds: 0, durationComplete: false });
  const [continuing, setContinuing] = useState(false); const [error, setError] = useState('');
  const source = job.sourceFolderPath || job.source?.path;
  const reason = readiness.status === 'Ready' ? '' : readiness.status === 'Empty' ? 'Add supported audio to Processing Order to continue.' : readiness.status === 'Checking' ? 'Checking processing files…' : readiness.issues[0] || 'Resolve the source file issues before continuing.';
  const proceed = async () => {
    setContinuing(true); setError('');
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/book-files`); const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not validate processing files.');
      setReadiness(data.readiness); if (data.readiness.status !== 'Ready') throw new Error(data.readiness.issues[0] || 'Add audio to Processing Order before continuing.');
      await onContinue();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not continue.'); } finally { setContinuing(false); }
  };
  return <div className="space-y-4">
    <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-[1fr_auto_1fr]"><h1 className="page-title-label justify-self-center text-xl font-bold md:col-start-2">Book Files</h1><div className="justify-self-end text-right"><button type="button" disabled={continuing || readiness.status !== 'Ready'} title={reason || 'Open the existing processing workflow'} onClick={() => void proceed()} className="paper-action-dark inline-flex items-center gap-2 rounded-lg bg-amber-800 px-3 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-40">{continuing ? 'Checking…' : 'Continue to Processing'}<ArrowRight className="h-4 w-4" /></button>{reason && <p className="mt-1 max-w-sm text-[11px] text-stone-500">{reason}</p>}</div></div>
    {error && <p role="alert" className="rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{error}</p>}
    <ProjectOverview key={job.id} job={job} />
    <OutputFolder job={job} config={config} onUpdateJobSettings={onUpdateJobSettings} />
    <AddFiles key="add-files" job={job} onChanged={onImported} />

    {source ? <SourceFileBrowser job={job} sourcePath={job.sourceFolderPath || source} config={config} onChanged={onChanged} onReadiness={setReadiness} /> : <WorkspaceSplit main={<WorkspacePanel id="panel-File Manager" collapsible resizable title="File Manager"><p className="p-6 text-sm text-stone-500">Add audio to start reviewing files.</p></WorkspacePanel>} aside={<ProcessingOrder job={job} readiness={{ status: 'Empty', issues: [], durationSeconds: 0, durationComplete: true }} busy={true} onOrder={() => {}} onRemove={() => {}} />} />}
    {children && <ResizableRegion storageKey="book-files-metadata" label="metadata">{children}</ResizableRegion>}
  </div>;
}

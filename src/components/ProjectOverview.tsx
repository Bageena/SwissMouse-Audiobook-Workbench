import { useId, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { AudiobookJob } from '../types';
import { BookCover } from './BookCover';
import { CoverFrame } from './CoverFrame';
import { DesktopWindow, useDesktopWorkspace } from './DesktopWorkspace';

export function projectOverviewStatus(job: AudiobookJob): { label: string; detail?: string } {
  const steps = Object.values(job.pipelineSteps || {});
  if (steps.some(step => step.status === 'running') || job.exports?.some(item => item.status === 'running')) return { label: 'Processing' };
  if (job.sourceMembershipReview) return { label: 'Review source files', detail: job.sourceMembershipReview };
  if (steps.some(step => step.status === 'failed') || (job.exports?.length && job.exports.every(item => item.status === 'failed'))) return { label: 'Processing needs attention' };
  if (job.sourceFilesChanged || steps.some(step => step.status === 'stale')) return { label: 'Needs reprocessing', detail: 'Source files or settings changed. Rerun processing to update the results.' };
  if (job.processingStatus === 'complete' || job.status === 'built' || job.status === 'validated') return { label: 'Processed' };
  if (job.status !== 'draft' || steps.some(step => step.hasOutput)) return { label: 'Processing started' };
  return { label: 'Draft' };
}

export function ProjectOverview({ job }: { job: AudiobookJob }) {
  const desktop = useDesktopWorkspace();
  const [expanded, setExpanded] = useState(true);
  const bodyId = useId();
  const metadata = { ...job.metadata, ...job.metadataDraft };
  const status = projectOverviewStatus(job);
  const author = metadata?.author || job.author;
  const narrator = metadata?.narrator;
  const duration = Number.isFinite(job.totalDurationSeconds) ? job.totalDurationSeconds : job.parts.reduce((sum, part) => sum + (part.durationSeconds || 0), 0);
  const size = Number.isFinite(job.totalSizeBytes) ? job.totalSizeBytes : job.parts.reduce((sum, part) => sum + (part.sizeBytes || 0), 0);
  const seconds = Math.max(0, Math.floor(duration));
  return <DesktopWindow id="project-overview" title="Project Overview" className="mx-auto w-full md:w-1/2 xl:w-1/3"><section data-collapsed={!expanded} aria-label="Project Overview" className={`project-overview workspace-panel mx-auto w-full min-w-0 rounded-xl border border-stone-200 bg-white shadow-sm ${desktop ? '' : 'md:w-1/2 xl:w-1/3'}`}>
    <header className={`workspace-panel-header workspace-toolbar px-4 py-3 ${expanded ? 'border-b border-stone-200' : 'workspace-panel-header-collapsed'}`}>
      <button type="button" aria-expanded={expanded} aria-controls={bodyId} onClick={() => setExpanded(value => !value)} className="workspace-header-toggle flex w-full items-center justify-between gap-2 text-left text-sm font-bold">
        <span className={`workspace-panel-title ${expanded ? '' : 'workspace-panel-title-flat'}`}>Project Overview</span>
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
      </button>
    </header>
    <div id={bodyId} hidden={!expanded} className="px-4 py-3 text-xs [overflow-wrap:anywhere]">
      <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1 space-y-2">
      <h2 className="text-sm font-bold">{metadata?.title || job.name}</h2>
      {(author || narrator) && <p className="text-stone-700">{author}{author && narrator && <span aria-hidden="true"> | </span>}{narrator}</p>}
      <p>{job.parts.length} {job.parts.length === 1 ? 'file' : 'files'} in project</p>
      <p className="text-stone-600">Total project time: {Math.floor(seconds / 3600)}h {Math.floor(seconds / 60) % 60}m {seconds % 60}s</p>
      <p className="text-stone-600">Size: {(size / (1024 * 1024)).toFixed(1)} MB</p>
      <p role="status" title={status.detail} className="font-semibold text-stone-700">{status.label}</p>
      </div>
      <div className="project-overview-cover shrink-0"><CoverFrame><BookCover url={metadata.cover?.url} title={metadata.title || job.name} /></CoverFrame></div>
      </div>
    </div>
  </section></DesktopWindow>;
}

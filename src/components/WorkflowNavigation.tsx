import { NavigationPanel } from './NavigationPanel';
import { canReviewChapters } from '../utils/pipelineRerun';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AudioLines, BookOpen, FolderOpen, Pencil, Upload, ShieldCheck } from 'lucide-react';
import type { AudiobookJob } from '../types';
import { DesktopWorkspace } from './DesktopWorkspace';
import { audiobookWorkflow, type WorkflowStep } from '../modules/audiobooks/manifest';

export type { WorkflowStep } from '../modules/audiobooks/manifest';
const workflowIcons = { 1: AudioLines, 2: BookOpen, 3: Pencil, 4: Upload, 5: ShieldCheck };
export const workflowPages = audiobookWorkflow.map(page => ({ ...page, icon: workflowIcons[page.step] }));

export function workflowStepState(job: AudiobookJob, step: WorkflowStep) {
  const completed = step === 1 ? job.status !== 'draft' || canReviewChapters(job)
    : step === 2 ? job.chapters.length > 0 && (job.status !== 'draft' || canReviewChapters(job))
    : step === 3 ? !!(job.pipelineSteps?.metadata_processing?.hasOutput || job.metadataUpdatedAt || ['metadata_ready', 'built', 'validated'].includes(job.status))
    : step === 4 ? ['built', 'validated'].includes(job.status) : job.status === 'validated';
  const stale = !!(completed && (step === 1 ? job.sourceFilesChanged
    : step === 2 ? job.staleSteps?.some(value => value === 'chapter_detection' || value === 'chapter_review')
    : step === 4 ? job.staleSteps?.includes('export') : step === 5 ? job.staleSteps?.includes('validation') : false));
  return { completed, stale };
}

function WorkspaceHeader({ children }: { children?: React.ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(document.getElementById('workspace-header-host')); }, []);
  return host && children ? createPortal(children, host) : null;
}

export function WorkflowLayout({ job, files, activeStep, onNavigate, children, header }: {
  job: AudiobookJob | null; files: boolean; activeStep: WorkflowStep;
  onNavigate: (page: 'files' | WorkflowStep) => void; children: React.ReactNode; header?: React.ReactNode;
}) {
  if (!job) return <DesktopWorkspace page="library"><WorkspaceHeader>{header}</WorkspaceHeader>{children}</DesktopWorkspace>;
  if (job.importPending) return <DesktopWorkspace page="files"><WorkspaceHeader>{header}</WorkspaceHeader>{children}</DesktopWorkspace>;
  const items = [{ step: 'files' as const, label: 'Book Files', description: 'Files and book details', icon: FolderOpen }, ...workflowPages];
  return <DesktopWorkspace page={files ? 'files' : `step-${activeStep}`}><WorkspaceHeader>{header}</WorkspaceHeader><div className={`library-layout workflow-layout `}>
    <NavigationPanel id="project-navigation" title={files ? 'File Manager Navigation' : 'Navigation'} navigationLabel="Audiobook creation steps" legacyOrientationKey="swissmouse-workflow-horizontal" items={items.map(item => ({
      id: String(item.step), buttonId: item.step === 'files' ? undefined : `tab-step-${item.step}`, label: item.label, description: item.description,
      icon: <item.icon />, active: item.step === 'files' ? files : !files && activeStep === item.step,
      ...(item.step === 'files' ? { completed: false, stale: false } : workflowStepState(job, item.step)), onClick: () => onNavigate(item.step),
    }))} />
    <div className={`processing-workspace min-w-0 ${!files && activeStep === 2 ? 'space-y-4' : 'space-y-5'}`}>{children}</div>
  </div></DesktopWorkspace>;
}

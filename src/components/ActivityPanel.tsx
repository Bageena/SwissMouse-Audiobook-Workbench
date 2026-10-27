import { useEffect, useState } from 'react';
import { Activity, RefreshCw, X } from 'lucide-react';
import type { AudiobookJob, JobLog, Step1ProcessState } from '../types';

export function ActivityPanel({ open, onClose, job, scanning, scanWarning, building, validating, exportMessage, exportError, exportJobId, logs, onLogs, onReview, onRefresh }: {
  open: boolean; onClose: () => void; job: AudiobookJob | null; scanning: boolean; scanWarning: string;
  building: boolean; validating: boolean; exportMessage: string; exportError: string | null; logs: JobLog[];
  onLogs: () => void; onReview: (step: 1 | 4 | 5) => void;
  onRefresh?: () => Promise<void>;
  exportJobId?: string | null;
}) {
  const [processing, setProcessing] = useState<Step1ProcessState | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [canceling, setCanceling] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { const response = await fetch('/api/step1/progress', { signal: controller.signal }); if (!response.ok) throw new Error('Processing status is unavailable.'); const data = await response.json(); if (!controller.signal.aborted) { setProcessing(data); setError(''); } }
      catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not read activity.'); }
      finally { if (!controller.signal.aborted) timer = setTimeout(refresh, 1500); }
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [open]);
  if (!open) return null;
  const cancel = async () => {
    setCanceling(true);
    setActionError('');
    try { const response = await fetch('/api/step1/cancel', { method: 'POST' }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not cancel processing.'); setProcessing(data.progress); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Could not cancel processing.'); }
    finally { setCanceling(false); }
  };
  const recent = logs.slice(-15).reverse();
  return <aside aria-label="Activity" className="activity-panel mx-auto mt-3 w-[calc(100%-24px)] max-w-[1480px] rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
    <header className="flex items-center gap-2"><Activity className="h-4 w-4" /><h2 className="flex-1 text-sm font-bold">Activity</h2><button type="button" onClick={onLogs} className="rounded border border-stone-300 px-2 py-1 text-xs">Technical logs</button><button type="button" aria-label="Close activity" onClick={onClose} className="rounded p-2"><X className="h-4 w-4" /></button></header>
    <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
      <section className="rounded-lg border border-stone-200 bg-stone-50 p-3"><h3 className="font-semibold">Library scan</h3><p role="status" className="mt-1">{scanning ? 'Scanning media folders…' : 'No scan running'}</p>{scanWarning && <><p className="mt-1 text-amber-800">{scanWarning}</p>{onRefresh && <button type="button" disabled={scanning || refreshing} onClick={() => { setRefreshing(true); setActionError(''); void onRefresh().catch(cause => setActionError(cause instanceof Error ? cause.message : 'Could not refresh the library.')).finally(() => setRefreshing(false)); }} className="mt-2 rounded border border-stone-300 px-2 py-1">{refreshing ? 'Refreshing…' : 'Refresh library'}</button>}</>}</section>
      <section className="rounded-lg border border-stone-200 bg-stone-50 p-3"><h3 className="font-semibold">Audio processing</h3><p role="status" className="mt-1">{error ? 'Status unavailable' : processing?.isActive ? processing.label || 'Processing…' : processing?.stage === 'cancelled' ? 'Canceled; completed preparation retained' : processing?.error ? 'Needs attention' : processing?.stage === 'completed' ? 'Last processing completed' : 'No processing running'}</p>
        {processing?.isActive && <><progress aria-label="Audio processing progress" value={processing.isDeterminate ? Math.max(0, Math.min(100, processing.percentage || 0)) : undefined} max={100} className="mt-2 w-full" />{processing.canCancel && <button type="button" onClick={() => void cancel()} disabled={canceling} className="mt-2 rounded border border-stone-300 px-2 py-1">{canceling ? 'Canceling…' : 'Cancel active processing'}</button>}</>}
        {processing?.error && <><p className="mt-1 text-red-700">{processing.error}</p>{job && processing.jobId === job.id && <button type="button" onClick={() => onReview(1)} className="mt-2 underline">Review processing and retry</button>}</>}
      </section>
      <section className="rounded-lg border border-stone-200 bg-stone-50 p-3"><h3 className="font-semibold">Import / export</h3><p role="status" className="mt-1">{building ? exportMessage || 'Creating audiobook…' : exportError ? 'Export needs attention' : job?.importPending ? 'Import awaiting review' : 'No import or export running'}</p>{exportError && <><p className="mt-1 text-red-700">{exportError}</p>{job && exportJobId === job.id && <button type="button" onClick={() => onReview(4)} className="mt-2 underline">Review export and retry</button>}</>}{!building && job?.exports?.some(item => item.status === 'success') && <p className="mt-1 text-stone-500">Finished exports are available in Final check.</p>}</section>
      <section className="rounded-lg border border-stone-200 bg-stone-50 p-3"><h3 className="font-semibold">Final check</h3><p role="status" className="mt-1">{validating ? 'Checking exported audiobook…' : job?.validation ? job.validation.status === 'PASS' ? 'Last check passed' : 'Last check needs attention' : 'No check running'}</p>{job?.validation && !validating && <button type="button" onClick={() => onReview(5)} className="mt-2 underline">Review final check</button>}</section>
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-red-700">{error} <RefreshCw className="inline h-3 w-3" /> Status refreshes automatically.</p>}
    {actionError && <p role="alert" className="mt-2 text-xs text-red-700">{actionError}</p>}
    <details className="mt-3 text-xs"><summary className="cursor-pointer font-semibold">Recent activity ({recent.length})</summary>{!recent.length ? <p className="mt-2 text-stone-500">No recent activity recorded.</p> : <ol className="mt-2 max-h-48 space-y-2 overflow-auto">{recent.map((log, index) => <li key={`${log.timestamp}:${index}`} className="break-words [overflow-wrap:anywhere]"><time className="mr-2 font-mono text-[10px] text-stone-500">{log.timestamp}</time><span className={log.level === 'ERROR' ? 'text-red-700' : log.level === 'WARNING' ? 'text-amber-800' : 'text-stone-600'}>{log.message}</span></li>)}</ol>}</details>
  </aside>;
}

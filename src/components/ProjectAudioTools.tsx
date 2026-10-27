import { LoadingMotion } from './LoadingMotion';
import { RefreshDocumentIcon } from './RefreshDocumentIcon';
import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import type { AudiobookJob } from '../types';

export function ProjectAudioTools({ job, onRecheckAudio, onShowLogs, busy = false, compact = false }: {
  job: AudiobookJob; onRecheckAudio: () => Promise<string>; onShowLogs: () => void; busy?: boolean; compact?: boolean;
}) {
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => { setNotice(null); }, [job?.id]);
  const recheck = async () => {
    if (!onRecheckAudio || checking || busy) return;
    setChecking(true); setNotice(null);
    try { setNotice({ text: await onRecheckAudio(), error: false }); }
    catch (error) { setNotice({ text: error instanceof Error ? error.message : 'Could not recheck project audio.', error: true }); }
    finally { setChecking(false); }
  };
  return (
      <div className="project-audio-tools relative shrink-0 rounded-xl border border-stone-200 p-1">
        <div role={compact ? "group" : "toolbar"} aria-label="Project audio tools" className="flex items-center gap-2">
          <button type="button" aria-label="Recheck project audio" aria-busy={checking} data-sm-loading={checking} title="Full audio check: decode every file, verify packet timestamps and compare stream parameters. Long books may take several minutes." disabled={checking || busy || !job.parts.length} onClick={() => void recheck()} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-stone-300 disabled:opacity-40"><LoadingMotion active={checking}><RefreshDocumentIcon kind="file" spinning={checking} /></LoadingMotion></button>
          {checking && <span role="status" className="sr-only">Full audio check in progress</span>}
          {notice?.error && <span role="alert"><button type="button" onClick={onShowLogs} aria-label="Audio recheck failed. See terminal log for details" title="Error: See terminal log for details" className="inline-flex h-7 w-7 items-center justify-center text-red-700"><AlertCircle className="h-4 w-4" /></button></span>}
        </div>
        {notice && !notice.error && <p role="status" title={notice.text} className={compact ? "sr-only" : "absolute right-0 top-full mt-2 w-72 max-w-[85vw] rounded-lg border border-stone-200 bg-white p-3 text-[11px] text-stone-600 shadow-lg"}>{notice.text}</p>}
      </div>
  );
}

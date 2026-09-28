import React, { useEffect, useRef, useState } from 'react';
import { JobLog } from '../types';
import { ChevronDown, ChevronUp, Terminal, X } from 'lucide-react';

interface LogsDrawerProps {
  logs: JobLog[];
  isOpen: boolean;
  onClose: () => void;
}

export const LogsDrawer: React.FC<LogsDrawerProps> = ({ logs, isOpen, onClose }) => {
  const panelRef = useRef<HTMLElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const followTail = useRef(true);
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    if (isOpen) panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [isOpen]);
  useEffect(() => {
    const feed = feedRef.current;
    if (isOpen && expanded && feed && followTail.current) {
      feed.scrollTop = feed.scrollHeight;
    }
  }, [isOpen, expanded, logs.length]);
  if (!isOpen) return null;

  return (
    <aside ref={panelRef} aria-label="Workbench Execution Logs" className="terminal-surface mx-auto mb-4 flex w-full max-w-[1480px] flex-col overflow-hidden rounded-xl border border-stone-800 bg-stone-950 text-stone-300 shadow-lg">
      <div className="min-h-10 bg-stone-900 px-4 flex items-center justify-between gap-3 text-xs">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-stone-200 font-mono">
          <Terminal className="w-3.5 h-3.5 text-amber-500" />
          <span className="font-semibold">Technical logs · All projects and sections</span>
          <span className="text-stone-500 text-[11px]">• {logs.length} entries</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls="technical-log-feed" aria-label={expanded ? 'Collapse technical logs' : 'Expand technical logs'} title={expanded ? 'Collapse logs' : 'Expand logs'} className="rounded p-1 text-stone-400 hover:bg-stone-800 hover:text-stone-200">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
          <button type="button" onClick={onClose} aria-label="Close technical logs" title="Close logs" className="rounded p-1 text-stone-400 hover:bg-stone-800 hover:text-stone-200">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div id="technical-log-feed" hidden={!expanded} ref={feedRef} role="log" aria-live="polite" onScroll={event => {
        const feed = event.currentTarget;
        followTail.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
      }} className="h-56 overflow-y-auto border-t border-stone-800 bg-stone-950 p-3 font-mono text-[11px] space-y-1">
        {logs.map((log, index) => (
          <div key={index} className="flex items-start space-x-2 leading-relaxed">
            <span className="text-stone-500 shrink-0 select-none">{log.timestamp}</span>
            <span
              className={`font-semibold shrink-0 select-none ${
                log.level === 'ERROR'
                  ? 'text-red-400'
                  : log.level === 'WARNING'
                  ? 'text-amber-400'
                  : 'text-emerald-400'
              }`}
            >
              [{log.level}]
            </span>
            <span className="text-stone-300 break-all">{log.message}</span>
          </div>
        ))}

        {logs.length === 0 && (
          <div className="text-stone-600 italic">No logs recorded yet.</div>
        )}
      </div>
    </aside>
  );
};

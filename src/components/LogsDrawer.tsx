import React from 'react';
import { JobLog } from '../types';
import { Terminal, X } from 'lucide-react';

interface LogsDrawerProps {
  logs: JobLog[];
  isOpen: boolean;
  onClose: () => void;
}

export const LogsDrawer: React.FC<LogsDrawerProps> = ({ logs, isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <aside aria-label="Workbench Execution Logs" className="terminal-surface fixed bottom-0 left-0 right-0 h-64 bg-stone-950 text-stone-300 border-t border-stone-800 z-40 flex flex-col shadow-2xl">
      <div className="h-9 bg-stone-900 border-b border-stone-800 px-4 flex items-center justify-between text-xs">
        <div className="flex items-center space-x-2 text-stone-200 font-mono">
          <Terminal className="w-3.5 h-3.5 text-amber-500" />
          <span className="font-semibold">Workbench Console (workbench_*.log)</span>
          <span className="text-stone-500 text-[11px]">• {logs.length} entries</span>
        </div>
        <button
          onClick={onClose}
          className="text-stone-400 hover:text-stone-200 text-xs px-1 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 p-3 overflow-y-auto font-mono text-[11px] space-y-1 bg-stone-950">
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

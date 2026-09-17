import React, { useState, useEffect } from 'react';
import { AudiobookJob } from '../types';
import { Plus, Settings, Trash2, BookOpen, Terminal, Wrench, AlertCircle } from 'lucide-react';
import swissMouseLogo from '../assets/swissmouse-logo-concept.png';

interface HeaderProps {
  jobs: AudiobookJob[];
  currentJob: AudiobookJob | null;
  onSelectJob: (jobId: string) => void;
  onCloseProject: () => void;
  onOpenNewJob: () => void;
  onOpenSettings: () => void;
  onOpenPurge: () => void;
  onOpenRequirements: () => void;
  onToggleLogs: () => void;
  showLogs: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  jobs,
  currentJob,
  onSelectJob,
  onCloseProject,
  onOpenNewJob,
  onOpenSettings,
  onOpenPurge,
  onOpenRequirements,
  onToggleLogs,
  showLogs,
}) => {
  const [statusColor, setStatusColor] = useState<'red' | 'yellow' | 'green'>('red');

  // Check requirements health on load
  useEffect(() => {
    let isMounted = true;
    const checkRequirementsHealth = async () => {
      try {
        const res = await fetch('/api/requirements/status');
        if (res.ok && isMounted) {
          const data = await res.json();
          setStatusColor(data.statusColor || 'red');
        }
      } catch (e) {}
    };

    checkRequirementsHealth();
    window.addEventListener('requirements-changed', checkRequirementsHealth);
    window.addEventListener('focus', checkRequirementsHealth);
    return () => {
      isMounted = false;
      window.removeEventListener('requirements-changed', checkRequirementsHealth);
      window.removeEventListener('focus', checkRequirementsHealth);
    };
  }, []);
  return (
    <header className="bg-stone-900 text-stone-100 border-b border-stone-800 sticky top-0 z-30 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo & Title */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg overflow-hidden shadow-inner ring-1 ring-amber-400/50 bg-stone-950">
            <img
              src={swissMouseLogo}
              alt="SwissMouse logo"
              className="w-full h-full object-cover"
            />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-lg tracking-tight text-stone-50">
                SwissMouse
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-stone-800 text-stone-300 font-mono">
                v0.1.0-alpha.1
              </span>
            </div>
            <p className="text-xs text-stone-400 hidden sm:block">
              The open source audiobook workbench.
            </p>
          </div>
        </div>

        {/* Center: Active Job Display / Navigation */}
        <div className="flex items-center space-x-2">
          {currentJob ? (
            <div className="flex items-center bg-stone-800/80 rounded-lg border border-stone-700/60 px-3 py-1.5 space-x-3">
              <div className="flex items-center space-x-2">
                <BookOpen className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-bold text-stone-50 truncate max-w-[200px]">
                  {currentJob.name}
                </span>
              </div>
              <div className="h-4 w-px bg-stone-700"></div>
              <button 
                onClick={onCloseProject}
                className="text-[10px] uppercase tracking-wider font-bold text-stone-400 hover:text-white transition-colors cursor-pointer"
              >
                Switch Book
              </button>
            </div>
          ) : (
            <div className="flex items-center bg-stone-800/80 rounded-lg border border-stone-700/60 px-3 py-1.5">
              <span className="text-xs font-bold text-stone-500 uppercase tracking-widest">
                No Active Project
              </span>
            </div>
          )}

          {!currentJob && (
            <button
              id="btn-new-job"
              onClick={onOpenNewJob}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition-colors cursor-pointer"
              title="Create a new audiobook project"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Add Book</span>
            </button>
          )}
        </div>

        {/* Right actions: Requirements, Purge, Settings, Logs toggle */}
        <div className="flex items-center space-x-2 ml-4 sm:ml-6">
          <button
            id="btn-open-requirements"
            onClick={onOpenRequirements}
            className={`flex items-center space-x-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors cursor-pointer relative ${
              statusColor === 'red'
                ? 'border-red-500 bg-red-950/40 text-red-300 hover:bg-red-900/50'
                : statusColor === 'yellow'
                ? 'border-amber-500 bg-amber-950/40 text-amber-300 hover:bg-amber-900/50'
                : 'border-stone-700 text-stone-300 hover:bg-stone-800 hover:text-stone-100'
            }`}
            title="Check or repair the local tools needed to process audio"
          >
            <Wrench className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Requirements</span>
            {statusColor === 'red' ? (
              <span className="flex h-2 w-2 relative -mr-0.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
            ) : statusColor === 'yellow' ? (
              <span className="flex h-2 w-2 relative -mr-0.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
            ) : (
              <span className="flex h-2 w-2 relative -mr-0.5">
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            )}
          </button>

          <button
            id="btn-open-purge"
            onClick={onOpenPurge}
            disabled={!currentJob}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800 hover:text-red-400 transition-colors disabled:opacity-40 cursor-pointer"
            title="Free disk space by removing generated working files"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Purge</span>
          </button>

          <button
            id="btn-open-settings"
            onClick={onOpenSettings}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800 hover:text-stone-100 transition-colors cursor-pointer"
            title="Change advanced default settings"
          >
            <Settings className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Config</span>
          </button>

          <button
            id="btn-toggle-terminal"
            onClick={onToggleLogs}
            className={`flex items-center space-x-1 px-2.5 py-1.5 text-xs rounded-lg border transition-colors cursor-pointer ${
              showLogs
                ? 'bg-stone-800 border-amber-500 text-amber-400'
                : 'border-stone-700 text-stone-400 hover:bg-stone-800 hover:text-stone-200'
            }`}
            title="Show or hide technical activity logs"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Logs</span>
          </button>
        </div>
      </div>
    </header>
  );
};

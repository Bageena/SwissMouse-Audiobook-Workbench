import React, { useState, useEffect } from 'react';
import { AudiobookJob } from '../types';
import { Plus, Settings, Trash2, BookOpen, Terminal, Wrench, MoreHorizontal, ChevronDown } from 'lucide-react';
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
    <header className="app-header sticky top-0 z-30 border-b border-stone-200/80 bg-white/95 text-stone-900 shadow-sm backdrop-blur-xl">
      <div className="mx-auto flex min-h-16 max-w-[1480px] items-center gap-3 px-3 py-2 sm:px-5 lg:px-7">
        <button type="button" onClick={onCloseProject} className="flex min-w-0 items-center gap-2.5 rounded-xl p-1 text-left transition hover:bg-stone-100" title="Go to your books">
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-stone-950 shadow-sm ring-1 ring-stone-200">
            <img
              src={swissMouseLogo}
              alt="SwissMouse logo"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="hidden min-w-0 sm:block">
            <span className="block text-base font-bold tracking-tight text-stone-950">SwissMouse</span>
            <span className="block text-[11px] font-medium text-stone-500">The Open Source Audiobook Workbench</span>
          </div>
        </button>

        <div className="min-w-0 flex-1 sm:ml-2">
          {currentJob ? (
            <div className="flex min-w-0 items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 sm:max-w-md">
              <BookOpen className="h-4 w-4 shrink-0 text-amber-700" />
              <div className="min-w-0">
                <span className="block truncate text-sm font-semibold text-stone-900">{currentJob.name}</span>
                <button onClick={onCloseProject} className="block text-[11px] font-medium text-stone-500 hover:text-amber-800">Switch book</button>
              </div>
            </div>
          ) : (
            <div className="text-sm font-medium text-stone-500">Your audiobook library</div>
          )}
        </div>

        <button
          id="btn-new-job"
          onClick={onOpenNewJob}
          className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-amber-700 px-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-800 active:translate-y-px"
          title="Create a new audiobook project"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Add book</span>
        </button>

        <details className="tools-menu relative shrink-0">
          <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50">
            <MoreHorizontal className="h-4 w-4" />
            <span className="hidden md:inline">More</span>
            <ChevronDown className="hidden h-3.5 w-3.5 md:block" />
          </summary>
          <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-64 overflow-hidden rounded-2xl border border-stone-200 bg-white p-2 shadow-xl">
            <p className="px-2 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-stone-400">Tools & settings</p>
          <button
            id="btn-open-requirements"
            onClick={onOpenRequirements}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-stone-700 transition hover:bg-stone-100"
            title="Check or repair the local tools needed to process audio"
          >
            <Wrench className="h-4 w-4 text-stone-500" />
            <span className="flex-1"><span className="block font-semibold">System check</span><span className="block text-[11px] text-stone-500">Audio tools and models</span></span>
            <span className={`h-2.5 w-2.5 rounded-full ${statusColor === 'red' ? 'bg-red-500' : statusColor === 'yellow' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
          </button>

          <button
            id="btn-open-purge"
            onClick={onOpenPurge}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-stone-700 transition hover:bg-red-50 hover:text-red-700"
            title="Clear cache and remove SwissMouse working files"
          >
            <Trash2 className="h-4 w-4" />
            <span><span className="block font-semibold">Free up space</span><span className="block text-[11px] text-stone-500">Cache and file cleanup</span></span>
          </button>

          <button
            id="btn-open-settings"
            onClick={onOpenSettings}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-stone-700 transition hover:bg-stone-100"
            title="Change advanced default settings"
          >
            <Settings className="h-4 w-4" />
            <span><span className="block font-semibold">Settings</span><span className="block text-[11px] text-stone-500">Processing defaults</span></span>
          </button>

          <button
            id="btn-toggle-terminal"
            onClick={onToggleLogs}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${showLogs ? 'bg-stone-900 text-white' : 'text-stone-700 hover:bg-stone-100'}`}
            title="Show or hide technical activity logs"
          >
            <Terminal className="h-4 w-4" />
            <span><span className="block font-semibold">Technical logs</span><span className={`block text-[11px] ${showLogs ? 'text-stone-300' : 'text-stone-500'}`}>{showLogs ? 'Currently visible' : 'Troubleshooting details'}</span></span>
          </button>
          </div>
        </details>
      </div>
    </header>
  );
};

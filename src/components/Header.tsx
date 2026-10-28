import lilTimmyDonate from '../assets/lil-timmy-donate.svg';
import { HeaderDockSurface, HEADER_PANEL_ID } from './HeaderDockSurface';
import { DesktopWindow, useDesktopWorkspace } from './DesktopWorkspace';
import { ToolbarPanel } from './ToolbarPanel';
import { ToolbarPopover } from './ToolbarPopover';
import { RefreshDocumentIcon } from './RefreshDocumentIcon';
import { ProjectAudioTools } from './ProjectAudioTools';
import { IdlePlayer } from './IdlePlayer';
import React, { useState, useEffect } from 'react';
import { AudiobookJob } from '../types';
import { Activity, Plus, Settings, Trash2, Terminal, Wrench, Eye, EyeOff } from 'lucide-react';
import { BookSelector } from './BookSelector';
import swissMouseLogo from '../assets/swissmouse-logo.svg';
import appPackage from '../../package.json';
import { PlayerAmbientGlow } from './PlayerAmbientGlow';

interface HeaderProps {
  ambientGlow?: boolean;
  busy?: boolean;
  onRecheckAudio?: () => Promise<string>;
  onShowLogs?: () => void;
  libraryPlayerJob?: AudiobookJob | null;
  playRequest?: number;
  currentJob: AudiobookJob | null;
  onCloseProject: () => void;
  onOpenNewJob: () => void;
  onOpenSettings: () => void;
  onResetPageLayout?: () => void;
  onOpenPurge: () => void;
  onOpenRequirements: () => void;
  onToggleLogs: () => void;
  showLogs: boolean;
  onToggleActivity?: () => void;
  showActivity?: boolean;
  onRatingChange?: (bookId: string, rating: number | null) => Promise<void>;
}

export const Header: React.FC<HeaderProps> = ({
  ambientGlow = true,
  busy, onRecheckAudio, onShowLogs,
  libraryPlayerJob,
  playRequest,
  currentJob,
  onCloseProject,
  onOpenNewJob,
  onOpenSettings,
  onResetPageLayout,
  onOpenPurge,
  onOpenRequirements,
  onToggleLogs,
  showLogs,
  onToggleActivity,
  showActivity,
  onRatingChange,
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
  const desktop = useDesktopWorkspace();
  const cornerHandlesVisible = desktop ? [...desktop.windows.keys()].some(id => !(desktop.state.panels[id]?.cornerHandleHidden ?? desktop.state.cornerHandlesHidden ?? true)) : false;
  const toggleCornerHandles = () => desktop?.commit(state => ({
    ...state, cornerHandlesHidden: cornerHandlesVisible,
    panels: Object.fromEntries(Object.entries(state.panels).map(([id, panel]) => {
      const { cornerHandleHidden: _hidden, ...preferences } = panel;
      return [id, preferences];
    })),
  }));
  const playerJob = currentJob || libraryPlayerJob;
  return (
    <HeaderDockSurface corner={<a className="header-patreon" href="https://www.patreon.com/c/Bageena" target="_blank" rel="noopener noreferrer" aria-label="Support SwissMouse on Patreon" title="Support SwissMouse on Patreon"><img src={lilTimmyDonate} alt="Lil Timmy holding a donate sign" /></a>} brand={
        <button type="button" onClick={onCloseProject} className={`flex min-h-16 min-w-0 flex-1 items-center justify-center gap-2.5 rounded-xl px-1 py-3 text-center transition hover:bg-stone-100 sm:w-72 sm:flex-none lg:my-2 lg:self-stretch`} title="Go to your books">
          <div className="h-16 w-16 shrink-0 sm:h-[72px] sm:w-[72px]">
            <img
              src={swissMouseLogo}
              alt="SwissMouse logo"
              className="w-full h-full object-contain"
            />
          </div>
          <span className="font-mono text-xs font-medium text-stone-600 sm:hidden">v{appPackage.version}</span>
          <div className="hidden min-w-0 sm:block text-center">
            <span className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xl font-bold leading-tight tracking-tight text-stone-950">SwissMouse <span className="rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-normal text-stone-600">v{appPackage.version}</span></span>
            <span className="mt-1 block text-[11px] font-medium leading-relaxed text-stone-500">The Open Source Audiobook Workbench</span>
          </div>
        </button>
    } player={
      <DesktopWindow id="header-media-player" title="Media Player" role="child" homeWindow={HEADER_PANEL_ID} minimumWidth={240}>
        <div className="header-media-player">
          <PlayerAmbientGlow enabled={ambientGlow} />
          <div data-container-heading className="media-player-heading"><span className="workspace-panel-title">Media Player</span></div>
          {playerJob ? (
            <BookSelector currentJob={playerJob} inShelf={!currentJob} playRequest={currentJob ? 0 : playRequest} onRatingChange={onRatingChange} />
          ) : (
            <IdlePlayer />
          )}
        </div>
      </DesktopWindow>
    } tools={
      <ToolbarPanel id="header-toolbar" title="Header Toolbar" homeWindow={HEADER_PANEL_ID} defaultHorizontal>
        <button
          id="btn-new-job" aria-label="Import Book"
          onClick={onOpenNewJob}
          className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold shadow-sm transition active:translate-y-px ${playerJob ? 'border border-stone-300 text-stone-700 hover:bg-stone-100' : 'bg-amber-700 text-white hover:bg-amber-800'}`}
          title="Import a book"
        >
          <Plus className="h-4 w-4" />
          <span className="sr-only">Import Book</span>
        </button>

        {onToggleActivity && <button type="button" aria-label="Activity" title="Activity" aria-expanded={!!showActivity} onClick={onToggleActivity} className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-stone-200 px-3 text-xs font-semibold text-stone-700"><Activity className="h-4 w-4" /><span className="sr-only">Activity</span></button>}
        {currentJob && onRecheckAudio && <ProjectAudioTools compact key={currentJob.id} job={currentJob} onRecheckAudio={onRecheckAudio} onShowLogs={onShowLogs || onToggleLogs} busy={busy} />}
        {desktop && <button type="button" aria-label={cornerHandlesVisible ? 'Hide panel layout controls' : 'Show panel layout controls'}
          title={cornerHandlesVisible ? 'Hide all move control tabs and corner icons on this page' : 'Show all move control tabs and corner icons on this page'} aria-pressed={cornerHandlesVisible}
          onClick={toggleCornerHandles} className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-stone-200 px-3 text-xs font-semibold text-stone-700">
          {cornerHandlesVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </button>}
        {onResetPageLayout && <button type="button" id="btn-reset-page-layout" aria-label="Reset page layout" onClick={onResetPageLayout} title="Restore this page’s default panel positions and sizes" className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-stone-200 px-3 text-xs font-semibold text-stone-700"><RefreshDocumentIcon kind="page" /><span className="sr-only">Reset page layout</span></button>}
      </ToolbarPanel>
    } fixedTools={
        <ToolbarPopover label="Tools and settings" icon={<Settings className="h-5 w-5" />}>
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
        </ToolbarPopover>
    } />
  );
};

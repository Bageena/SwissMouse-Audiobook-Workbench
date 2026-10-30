import { AudiobookWorkspaceView, useAudiobookWorkspace } from './modules/audiobooks';
import { ThemeBackground } from './components/ThemeBackground';
import { readApiJson } from './utils/apiResponse';
import { readSharedTheme, saveSharedTheme } from './utils/sharedAppearance';
import { useState, useEffect, useRef, useMemo } from 'react';
import {
  WorkbenchConfig,
} from './types';
import { AsyncState } from './components/AsyncState';
import { CleanupModal } from './components/CleanupModal';
import { ConfigModal } from './components/ConfigModal';
import { RequirementsModal } from './components/RequirementsModal';
import { LogsDrawer } from './components/LogsDrawer';
import { CustomTheme, ThemeDiscoveryResponse, DEFAULT_THEME, getStoredTheme, isAppTheme, persistTheme } from './theme';
import type { JobLog } from './types';

export default function App({hostPreferences,registerBeforeDeactivate}:{hostPreferences?:()=>void;registerBeforeDeactivate?:(prepare:()=>Promise<boolean>)=>()=>void}={}) {
  const [config, setConfig] = useState<WorkbenchConfig | null>(null);
  useEffect(()=>{const update=(event:Event)=>setConfig((event as CustomEvent<WorkbenchConfig>).detail);window.addEventListener('swissmouse-audiobook-config-saved',update);return()=>window.removeEventListener('swissmouse-audiobook-config-saved',update);},[]);
  const [theme, setTheme] = useState<string>(getStoredTheme);
  const themePreferenceRevision = useRef(0);
  const pendingThemeWrites = useRef(0);
  const [appearanceLoaded, setAppearanceLoaded] = useState(false);
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>([]);
  const [themeWarnings, setThemeWarnings] = useState<string[]>([]);
  const [isReloadingThemes, setIsReloadingThemes] = useState(false);

  // Modals
  const [showPurgeModal, setShowPurgeModal] = useState<boolean>(false);
  const [preferencesPresentation, setPreferencesPresentation] = useState<'quick' | 'preferences'>('preferences');
  const [preferencesSection, setPreferencesSection] = useState('appearance');
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [showRequirementsModal, setShowRequirementsModal] = useState<boolean>(false);
  const [showLogsDrawer, setShowLogsDrawer] = useState<boolean>(false);
  const [showActivity, setShowActivity] = useState(false);
  const [masterLogs, setMasterLogs] = useState<JobLog[]>([]);
  const [clientLogs, setClientLogs] = useState<JobLog[]>([]);
  const technicalLogs = useMemo(() => [...new Map([...masterLogs, ...clientLogs].map(entry => [`${entry.timestamp}|${entry.level}|${entry.message}`, entry])).values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)), [masterLogs, clientLogs]);
  const logClientFailure = (message: string) => {
    const entry: JobLog = { timestamp: new Date().toISOString(), level: 'ERROR', message: `[Project audio check] ${message}` };
    setClientLogs(previous => [...previous.slice(-199), entry]);
    void fetch('/api/logs/client', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) }).catch(() => {});
  };

  const reloadCustomThemes = async () => {
    const revision = themePreferenceRevision.current;
    setIsReloadingThemes(true);
    try {
      const response = await fetch('/api/themes');
      if (!response.ok) throw new Error('Could not scan the custom themes folder.');
      const discovery: ThemeDiscoveryResponse = await response.json();
      setCustomThemes(discovery.themes);
      setThemeWarnings(discovery.warnings);
      let selected = getStoredTheme();
      try { selected = await saveSharedTheme(selected, true); }
      catch (error) { setThemeWarnings(previous => [...previous, error instanceof Error ? error.message : 'Could not load shared appearance.']); }
      if (revision !== themePreferenceRevision.current) return;
      const customTheme = discovery.themes.find(candidate => candidate.id === selected);
      if (isAppTheme(selected)) {
        setTheme(selected);
        persistTheme(selected);
      } else if (customTheme) {
        setTheme(selected);
        persistTheme(selected, customTheme);
      } else {
        setTheme(DEFAULT_THEME);
        persistTheme(DEFAULT_THEME);
      }
    } catch (error) {
      console.error('Failed to load custom themes:', error);
      setThemeWarnings([error instanceof Error ? error.message : 'Could not load custom themes.']);
      if (!isAppTheme(getStoredTheme())) {
        setTheme(DEFAULT_THEME);
        persistTheme(DEFAULT_THEME);
      }
    } finally {
      setIsReloadingThemes(false);
      setAppearanceLoaded(true);
    }
  };

  useEffect(() => { void reloadCustomThemes(); }, []);

  const handleThemeChange = (nextTheme: string) => {
    themePreferenceRevision.current++;
    pendingThemeWrites.current++;
    const customTheme = customThemes.find(candidate => candidate.id === nextTheme);
    setTheme(nextTheme);
    persistTheme(nextTheme, customTheme);
    void saveSharedTheme(nextTheme).catch(error => {
      setThemeWarnings(previous => [...previous, error instanceof Error ? error.message : 'Could not save shared appearance.']);
    }).finally(() => { pendingThemeWrites.current--; });
  };

  useEffect(() => {
    if (!appearanceLoaded) return;
    let stopped = false;
    let checking = false;
    const synchronize = async () => {
      if (checking || pendingThemeWrites.current || document.visibilityState === 'hidden') return;
      checking = true;
      const revision = themePreferenceRevision.current;
      try {
        const selected = await readSharedTheme();
        if (stopped || revision !== themePreferenceRevision.current || pendingThemeWrites.current || !selected || selected === getStoredTheme()) return;
        const customTheme = customThemes.find(candidate => candidate.id === selected);
        if (!isAppTheme(selected) && !customTheme) return;
        setTheme(selected);
        persistTheme(selected, customTheme);
      } catch { /* Keep the cached theme while the local server is unavailable. */ }
      finally { checking = false; }
    };
    const refresh = () => { void synchronize(); };
    const timer = window.setInterval(refresh, 10000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    refresh();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [appearanceLoaded, customThemes]);

  const handleOpenThemesFolder = async () => {
    const response = await fetch('/api/themes/open-folder', { method: 'POST' });
    if (!response.ok) throw new Error('Could not open the custom themes folder.');
  };

  const workspace = useAudiobookWorkspace({ setConfig,
    loadConfig: async (signal, context) => {
      const response = await fetch('/api/config', { signal });
      if (context === 'quick-tags' && !response.ok) throw new Error('Could not load Quick Tags.');
      const data = await readApiJson(response, 'Load settings');
      if (!response.ok || !data || typeof data !== 'object') throw new Error(data?.error || 'Could not load settings. Check that SwissMouse is running and try again.');
      return data;
    },
    cleanupShared: async (cleanupType, confirmation) => {
      const response = await fetch('/api/cleanup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cleanupType, confirmation }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Cleanup failed');
      return data;
    },
    pickAudio: async folder => {
      const response = await fetch(folder ? '/api/system/pick-audio-folder' : '/api/system/pick-audio-file', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not open the file browser.');
      return data;
    },
    handleSaveConfig: value => handleSaveConfig(value), onShowLogs: () => setShowLogsDrawer(true), onClientFailure: logClientFailure,
  });

  const { currentJob, isLoading, startupError, setStartupAttempt, handleCleanup, handleRefreshLibrary, handleLibraryRebuilt } = workspace;
  const beforeDeactivate=useRef(workspace.prepareToLeaveBook);beforeDeactivate.current=workspace.prepareToLeaveBook;
  useEffect(()=>registerBeforeDeactivate?.(()=>beforeDeactivate.current()),[registerBeforeDeactivate]);

  // The Settings terminal combines every project's saved activity with the
  // section streams, including work performed while no project is open.
  useEffect(() => {
    if (!showLogsDrawer && !showActivity) return;
    let stopped = false;
    const refresh = async () => {
      try {
        const response = await fetch('/api/logs');
        if (response.ok && !stopped) setMasterLogs(await response.json());
      } catch (error) { console.error('Failed to read technical logs:', error); }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 750);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [showLogsDrawer, showActivity]);

  // Config Update Handler
  const handleSaveConfig = async (newConfig: WorkbenchConfig) => {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Config update failed');
    setConfig(data.config);
    if (data.config.inbox_folder !== config?.inbox_folder || data.config.library_folder !== config?.library_folder) await handleRefreshLibrary();
    return data.config as WorkbenchConfig;
  };

  if (startupError || isLoading || !config) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center p-4">
        <AsyncState kind={startupError ? 'error' : 'loading'} title={startupError ? 'Could not start SwissMouse' : 'Starting SwissMouse…'} message={startupError || undefined} onRetry={() => setStartupAttempt(value => value + 1)} />
      </div>
    );
  }

  return (
    <div className="app-shell min-h-screen flex flex-col font-sans">
      <ThemeBackground enabled={theme === 'cheese' || customThemes.some(item => item.id === theme && item.extends === 'cheese')} />
      {/* Top Header */}
      <div id="workspace-header-host" className="workspace-header-host" />

      <AudiobookWorkspaceView workspace={workspace} config={config} shell={{
        onPreferences: section => { if(hostPreferences){hostPreferences();return;}setPreferencesPresentation('preferences'); setPreferencesSection(section); setShowConfigModal(true); },
        onQuickSettings: () => { setPreferencesPresentation('quick'); setShowConfigModal(true); },
        onPurge: () => setShowPurgeModal(true), onToggleLogs: () => setShowLogsDrawer(value => !value),
        onShowLogs: () => setShowLogsDrawer(true), showLogs: showLogsDrawer,
        onToggleActivity: () => setShowActivity(value => !value), onCloseActivity: () => setShowActivity(false),
        showActivity, logs: technicalLogs, onConfigChange: setConfig,
      }} />

      {/* Technical log follows the workspace so it never covers its controls. */}
      <LogsDrawer
        logs={technicalLogs}
        isOpen={showLogsDrawer}
        onClose={() => setShowLogsDrawer(false)}
      />

      {/* Modals */}
      {showPurgeModal && (
        <CleanupModal
          job={currentJob}
          onClose={() => setShowPurgeModal(false)}
          onCleanup={handleCleanup}
        />
      )}

      {showConfigModal && (
        <ConfigModal
          resourceId={currentJob?.id}
          presentation={preferencesPresentation}
          initialSection={preferencesSection}
          config={config}
          theme={theme}
          customThemes={customThemes}
          themeWarnings={themeWarnings}
          isReloadingThemes={isReloadingThemes}
          onThemeChange={handleThemeChange}
          onReloadThemes={reloadCustomThemes}
          onOpenThemesFolder={handleOpenThemesFolder}
          onClose={() => setShowConfigModal(false)}
          onSaveConfig={handleSaveConfig}
          onRebuilt={handleLibraryRebuilt}
        />
      )}

      {showRequirementsModal && (
        <RequirementsModal
          onClose={() => setShowRequirementsModal(false)}
        />
      )}
    </div>
  );
}

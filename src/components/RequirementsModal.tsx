import { capabilityLabel } from '../transcription';
import { expandRequirementSelection, requirementDependencies } from '../../tools/requirements';
import React, { useState, useEffect, useRef } from 'react';
import {
  RequirementsReport,
  BaseRequirementItem,
  InstallRepairProgress,
} from '../types';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Cpu,
  HardDrive,
  Wrench,
  ShieldCheck,
  Info,
  Terminal,
  X,
  ExternalLink,
  Zap,
} from 'lucide-react';

interface RequirementsModalProps {
  onClose: () => void;
}

export const RequirementsModal: React.FC<RequirementsModalProps> = ({ onClose }) => {
  const [report, setReport] = useState<RequirementsReport | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [progressState, setProgressState] = useState<InstallRepairProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showFullLogs, setShowFullLogs] = useState<boolean>(false);
  const [actionPending, setActionPending] = useState(false);
  const busy = actionPending || isRefreshing || !!progressState?.isActive;

  const [selectedIds, setSelectedIds] = useState<string[]>(['faster_whisper']);
  const [pytorchFlavor, setPytorchFlavor] = useState<'keep' | 'cpu' | 'cuda'>('keep');
  const selected = new Set(expandRequirementSelection(selectedIds));
  const lastPhase = useRef('');

  // Load status
  const fetchStatus = async (isRefreshAction = false) => {
    if (isRefreshAction) setIsRefreshing(true);
    else setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/requirements/status${isRefreshAction ? '?refresh=true' : ''}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch requirements status.');
      setReport(data);
      if (data.components.some((item: BaseRequirementItem) => item.id === 'pytorch' && item.source === 'system')) setPytorchFlavor('keep');
      window.dispatchEvent(new Event('requirements-changed'));
    } catch (e: any) {
      setErrorMsg(e.message || 'Error checking requirements.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  // Poll installation progress when active
  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    const checkProgress = async () => {
      try {
        const res = await fetch('/api/requirements/install-progress');
        if (res.ok) {
          const prog: InstallRepairProgress = await res.json();
          setProgressState(prog);
          if (prog.isActive) {
            // keep polling
          } else if (['completed', 'error', 'cancelled'].includes(prog.phase) && lastPhase.current !== prog.phase) {
            // refresh report once finished
            fetchStatus();
          }
          lastPhase.current = prog.phase;
        }
      } catch (e) {}
    };

    checkProgress();
    if (progressState?.isActive) interval = setInterval(checkProgress, 1500);
    return () => clearInterval(interval);
  }, [progressState?.isActive]);

  // Trigger Install / Repair
  const handleInstallRepair = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    const replacingTorch = pytorchFlavor !== 'keep' && !!report?.components.find(item => item.id === 'pytorch')?.installedVersion;
    if (replacingTorch && !window.confirm('Replace the installed PyTorch build with the selected ' + pytorchFlavor.toUpperCase() + ' build? This affects regular Whisper. Existing speech models and projects will be kept.')) return;
    setActionPending(true);
    try {
      const res = await fetch('/api/requirements/install-repair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selectedIds, ...(pytorchFlavor === 'keep' ? {} : { pytorchFlavor, confirmPytorchReplacement: replacingTorch }) }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start installation/repair.');
      
      if (data.status === 'ok' && data.message && data.message.includes('No installation needed')) {
        setSuccessMsg(data.message);
        return;
      }
      
      setPytorchFlavor('keep');
      // Fetch progress immediately
      const progRes = await fetch('/api/requirements/install-progress');
      if (progRes.ok) {
        setProgressState(await progRes.json());
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to trigger installation.');
    } finally { setActionPending(false); }
  };

  const handleUninstall = async (component: BaseRequirementItem) => {
    if (!window.confirm(`Remove the app-managed copy of ${component.name}?\n\n${component.uninstallImpact || ''}\n\nLocation: ${component.managedLocation}\n\nSystem installations, downloaded models, projects and audio will be kept.`)) return;
    setActionPending(true); setErrorMsg(null); setSuccessMsg(null);
    try {
      const response = await fetch('/api/requirements/uninstall', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: component.id, confirmed: true }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not remove component.');
      const progress = await fetch('/api/requirements/install-progress');
      if (!progress.ok) throw new Error('Removal started, but progress could not be loaded. Reopen this screen to check.');
      const state: InstallRepairProgress = await progress.json();
      setProgressState(state);
      if (!state.isActive) await fetchStatus();
    } catch (error: any) { setErrorMsg(error.message); }
    finally { setActionPending(false); }
  };

  // Trigger Cancel
  const handleCancelInstallation = async () => {
    try {
      await fetch('/api/requirements/cancel', { method: 'POST' });
      const progRes = await fetch('/api/requirements/install-progress');
      if (progRes.ok) {
        setProgressState(await progRes.json());
      }
    } catch (e) {}
  };

  const getStatusBadge = (component: BaseRequirementItem) => {
    const { status, classification } = component;
    if (classification === 'optional' && status === 'missing' && (component.id === 'faster_whisper' || (component.id === 'nvidia_acceleration' && report?.hardware.hasNvidiaGpu))) {
      return <span className="text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded text-[11px]">Recommended improvement</span>;
    }
    if (classification === 'optional' && status === 'missing') {
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-stone-100 text-stone-600 border border-stone-200">○ Optional</span>;
    }
    switch (status) {
      case 'ready':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            <span>Ready</span>
          </span>
        );
      case 'missing':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-red-100 text-red-800 border border-red-200">
            <XCircle className="w-3 h-3 text-red-600" />
            <span>Missing</span>
          </span>
        );
      case 'broken':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">
            <AlertTriangle className="w-3 h-3 text-amber-600" />
            <span>Attention</span>
          </span>
        );
      case 'installing':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-100 text-blue-800 border border-blue-200 animate-pulse">
            <RefreshCw className="w-3 h-3 text-blue-600 animate-spin" />
            <span>Installing...</span>
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div role="dialog" aria-modal="true" aria-label="System setup and tools" className="bg-white rounded-xl max-w-4xl w-full shadow-2xl border border-stone-200 flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-stone-900 text-amber-400 rounded-lg shadow-xs">
              <Wrench className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900">System setup and tools</h2>
              <p className="text-xs text-stone-500">
                Check and repair the local tools SwissMouse needs to process audio.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-200/60 transition-colors cursor-pointer"
            title="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-stone-800 text-xs">
          {/* Summary Banner */}
          {report && (
            <div className={`p-3 rounded-lg border flex items-start space-x-3 ${
              report.statusColor === 'red' 
                ? 'bg-red-50 border-red-200 text-red-800' 
                : report.statusColor === 'yellow' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}>
              {report.statusColor === 'red' ? (
                <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              ) : report.statusColor === 'yellow' ? (
                <Zap className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1">
                <p className="font-bold text-xs uppercase tracking-tight">Overall Status: {report.statusColor === 'red' ? 'Setup Required' : report.statusColor === 'yellow' ? 'Ready — Optional Improvement Available' : 'Ready'}</p>
                <p className="text-[11px] leading-relaxed opacity-90">{report.summaryMessage}</p>
              </div>
            </div>
          )}

          {report && <details className="rounded-lg border border-stone-200 bg-stone-50 p-3 space-y-2">
            <summary className="font-semibold cursor-pointer">{report.runtimeMode === 'managed' ? 'App-managed mode' : 'System first · App-managed fallback'} — how it works{report.runtimeWarnings?.length ? ` (${report.runtimeWarnings.length} discovery notes)` : ''}</summary>
            <p>{report.runtimeMode === 'managed' ? 'System discovery is disabled by SWISSMOUSE_RUNTIME_MODE=managed.' : 'At startup, SwissMouse checks PATH for compatible tools. It uses complete system Python environments when available and its private environment for missing engines. Check again rescans while no work is running.'}</p>
            <p>Install and Remove affect only SwissMouse-owned copies. System installations stay under your control.</p>
            <p>Audio processing stays local. Removing tools keeps your models, projects and audio; downloaded models are managed separately in Models.</p>
            {!!report.runtimeWarnings?.length && <details><summary className="cursor-pointer font-medium">Discovery notes ({report.runtimeWarnings.length})</summary><ul className="mt-2 space-y-1 break-words">{report.runtimeWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
          </details>}

          {/* Active Progress Banner if running */}
          {progressState && progressState.isActive && (
            <div className="p-4 bg-amber-50 border border-amber-300 rounded-lg space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2 font-semibold text-amber-900">
                  <RefreshCw className="w-4 h-4 text-amber-700 animate-spin" />
                  <span>{progressState.currentActivity}</span>
                </div>
                <span className="font-bold font-mono text-amber-800">{progressState.overallProgress}%</span>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-amber-200/80 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-amber-600 h-full rounded-full transition-all duration-300"
                  style={{ width: `${progressState.overallProgress}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-amber-800">
                <span className="truncate max-w-[80%]">{progressState.logs[progressState.logs.length - 1] || 'Processing components...'}</span>
                {progressState.canCancel && (
                  <button
                    onClick={handleCancelInstallation}
                    className="px-2 py-0.5 bg-amber-200 hover:bg-amber-300 text-amber-900 rounded font-medium cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Success / Finished Message */}
          {progressState && !progressState.isActive && progressState.phase === 'completed' && (
            <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-lg flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="font-medium">{progressState.successMessage || 'Action finished successfully.'}</span>
              </div>
              <button
                onClick={() => setProgressState(null)}
                className="text-xs text-emerald-700 hover:text-emerald-900 underline ml-2"
              >
                Dismiss
              </button>
            </div>
          )}

          {progressState && !progressState.isActive && progressState.phase === 'error' && (
            <div className="p-3 bg-red-50 border border-red-300 text-red-900 rounded-lg flex items-start justify-between gap-3">
              <div className="flex items-start space-x-2">
                <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span className="font-medium">{progressState.error || 'Installation did not pass verification. See the execution log for details.'}</span>
              </div>
              <button
                onClick={() => setProgressState(null)}
                className="text-xs text-red-700 hover:text-red-900 underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Error Message if any */}
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start space-x-2">
              <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Success Message if any */}
          {successMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700 flex items-start space-x-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Requirements Component List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between pb-1 border-b border-stone-200">
              <span className="font-bold text-stone-900 text-xs uppercase tracking-wider">
                Available components
              </span>
              <button
                onClick={() => fetchStatus(true)}
                disabled={busy}
                className="flex items-center space-x-1 text-xs text-stone-600 hover:text-stone-900 font-medium disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-amber-600' : ''}`} />
                <span>Check again</span>
              </button>
            </div>

            {isLoading ? (
              <div className="py-8 text-center text-stone-500 space-y-2">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto text-amber-600" />
                <p>Checking audio tools, Python, and folder access...</p>
              </div>
            ) : report ? (
              <div className="space-y-3">
                {([
                  ['core', 'Core Requirements'],
                  ['active_transcription', 'Recommended Transcription Engine'],
                  ['optional_acceleration', 'Optional Acceleration'],
                  ['compatibility', 'Other Optional Tools'],
                ] as const).map(([groupId, groupLabel]) => {
                  const group = report.components.filter(comp => (comp.group || 'core') === groupId);
                  if (!group.length) return null;
                  return <div key={groupId} className="border border-stone-200 rounded-lg overflow-hidden bg-white">
                    <div className="px-3 py-2 bg-stone-50 border-b border-stone-200 font-bold text-stone-800">{groupLabel}</div>
                    <div className="divide-y divide-stone-100">{group.map((comp) => (
                  <div key={comp.id} className="p-3 hover:bg-stone-50/70 transition-colors space-y-1.5">
                    <div className="flex flex-wrap gap-2 items-start justify-between">
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <input type="checkbox" aria-label={`Include ${comp.name}`} checked={comp.classification === 'required' || selected.has(comp.id)}
                            disabled={comp.classification === 'required' || !comp.isAppManaged || busy || Object.entries(requirementDependencies).some(([parent, children]) => selected.has(parent) && children.includes(comp.id))}
                            onChange={event => setSelectedIds(ids => event.target.checked ? [...ids, comp.id] : ids.filter(id => id !== comp.id && !(requirementDependencies[comp.id] || []).includes(id)))} />
                          <span className="font-semibold text-stone-900 text-xs">{comp.name}{comp.classification === 'required' ? ' (Required)' : ' (Optional)'}</span>
                          <span className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                            comp.isAppManaged ? 'bg-stone-100 text-stone-600 border border-stone-200' : 'bg-stone-100 text-stone-500'
                          }`}>
                            {comp.source === 'system' ? 'System · in use' : comp.status === 'ready' ? 'App-managed · in use' : 'App-managed'}
                          </span>
                        </div>
                        <p className="text-[11px] text-stone-500 leading-snug">{comp.purpose}</p>
                      </div>

                      <div className="shrink-0 ml-3 text-right">
                        {getStatusBadge(comp)}
                        {comp.installedVersion && (
                          <p className="text-[10px] text-stone-500 font-mono mt-0.5">
                            v{comp.installedVersion}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Diagnostic or error message */}
                    {comp.error ? (
                      <div className="p-2 rounded bg-amber-50/80 border border-amber-200 text-amber-900 text-[11px] flex items-start space-x-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                        <span>{comp.error}</span>
                      </div>
                    ) : comp.diagnosticDetails ? (
                      <p className="text-[11px] text-stone-500 truncate">
                        ✓ {comp.diagnosticDetails}
                      </p>
                    ) : null}

                    {comp.installLocation && (
                      <p className="text-[10px] text-stone-500 font-mono break-all">
                        {comp.status === 'ready' ? 'Active path' : 'Runtime path'}: {comp.installLocation}
                      </p>
                    )}
                    {comp.classification === 'optional' && <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="text-[11px] text-stone-500 min-w-0 flex-1">
                        {comp.source === 'system' && <p>System copy is protected. Remove or update it with its original package manager.</p>}
                        {comp.canUninstall && <p className="break-all">{comp.source === 'system' ? 'Unused app copy' : 'Removable app copy'}: {comp.managedLocation}</p>}
                      </div>
                      {comp.canUninstall && <button type="button" disabled={busy || isLoading} onClick={() => handleUninstall(comp)} aria-label={`Remove app-managed ${comp.name}`} className="rounded border border-red-300 px-3 py-1 text-red-700 hover:bg-red-50 disabled:opacity-50 shrink-0">Remove app copy</button>}
                    </div>}
                  </div>
                    ))}</div>
                  </div>;
                })}
              </div>
            ) : null}
          </div>

          {/* Hardware Detection Card */}
          {report && (
            <details className="hardware-card rounded-lg border border-stone-200 bg-white p-3.5 text-stone-800 space-y-2.5">
              <summary className="cursor-pointer font-semibold">Your computer & hardware detection</summary>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Cpu className="w-4 h-4 text-amber-700" />
                  <span className="font-semibold text-xs text-stone-900">Your computer</span>
                </div>
                <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider ${
                  report.hardware.hasNvidiaGpu ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-stone-100 text-stone-700 border border-stone-200'
                }`}>
                  {report.hardware.hasNvidiaGpu ? 'NVIDIA GPU Detected' : 'CPU Ready'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-stone-600 bg-stone-50 p-2.5 rounded border border-stone-200">
                <div>
                  <span className="text-stone-500">Processor:</span>{' '}
                  <span className="font-medium text-stone-800">{report.hardware.cpuModel}</span>
                </div>
                <div>
                  <span className="text-stone-500">Platform:</span>{' '}
                  <span className="font-medium text-stone-800">{report.hardware.os} ({report.hardware.arch})</span>
                </div>
                {report.hardware.hasNvidiaGpu ? (
                  <>
                    <div>
                      <span className="text-stone-400">Graphics Card:</span>{' '}
                      <span className="font-medium text-emerald-300">{report.hardware.gpuName}</span>
                    </div>
                    <div>
                      <span className="text-stone-400">GPU VRAM:</span>{' '}
                      <span className="font-medium text-emerald-300">~{report.hardware.vramGb || 'N/A'} GB {report.hardware.cudaVersion ? `(CUDA ${report.hardware.cudaVersion})` : ''}</span>
                    </div>
                  </>
                ) : (
                  <div className="md:col-span-2 text-stone-500 italic">
                    No compatible NVIDIA GPU was found. Speech recognition will still work on the CPU, though it may take longer.
                  </div>
                )}
              </div>

              <div className="flex items-center space-x-2 text-[11px] text-amber-800 pt-0.5">
                <Zap className="w-3.5 h-3.5 shrink-0" />
                <span>{report.hardware.recommendationSummary}</span>
              </div>
            </details>
          )}
          {report && <details className="rounded-lg border border-stone-200 bg-stone-50 p-4 space-y-3">
            <summary className="font-bold cursor-pointer">GPU capabilities & PyTorch setup</summary>
            {Object.values(report.backendCapabilities || {}).map(capability => capability && <div key={capability.engine} className="space-y-1">
              <p className="font-semibold">{capability.engine === 'faster-whisper' ? 'Faster Whisper / CTranslate2' : 'Regular Whisper / PyTorch'}: {capabilityLabel(capability)}</p>
              <p>Runtime version: {capability.runtimeVersion || 'Unavailable'} · GPU initialization: {capability.initialization}</p>
              {capability.engine === 'openai-whisper' && <p>CUDA support: {capability.cudaBuilt === undefined ? 'Unknown' : capability.cudaBuilt ? 'Yes' : 'No'} · CUDA runtime: {capability.cudaVersion || 'None'} · GPU available to PyTorch: {capability.gpuAvailable ? 'Yes' : 'No'}</p>}
              {capability.reason && <p>{capability.reason}</p>}
            </div>)}
            <p>Faster Whisper uses CTranslate2. Its GPU acceleration does not require CUDA-enabled PyTorch. Runtime queries do not load a speech model; Faster Whisper GPU model initialization is verified during transcription.</p>
            <label className="block space-y-1">
              <span className="font-semibold">PyTorch installation (regular Whisper only)</span>
              <select aria-label="PyTorch installation" value={pytorchFlavor} disabled={busy || report.components.some(item => item.id === 'pytorch' && item.source === 'system')}
                onChange={event => setPytorchFlavor(event.target.value as 'keep' | 'cpu' | 'cuda')}
                className="block w-full rounded border border-stone-300 bg-white p-2">
                <option value="keep">Keep existing build (CPU default for a missing dependency)</option>
                <option value="cpu">Install CPU PyTorch</option>
                <option value="cuda" disabled={!report.pytorchBuild?.cudaAvailable}>Install GPU/CUDA PyTorch{report.pytorchBuild?.cudaAvailable ? '' : ' — unavailable'}</option>
              </select>
            </label>
            {report.components.some(item => item.id === 'pytorch' && item.source === 'system') && <p>System PyTorch is in use. Manage its CPU/CUDA build outside SwissMouse, then check again.</p>}
            <p>Faster Whisper uses the same downloaded model on CPU and GPU; this PyTorch setting does not enable or disable its GPU acceleration.</p>
            <p>NVIDIA driver: {report.hardware.driverVersion || 'Unknown'} · Driver CUDA compatibility: {report.hardware.cudaVersion || 'Unknown'} · GPU compute capability: {report.hardware.computeCapability ?? 'Unknown'}</p>
            <p>{report.pytorchBuild?.reason} Existing builds are replaced only after confirmation.</p>
          </details>}
          {/* Diagnostic Execution Logs Toggle */}
          {progressState && progressState.logs.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowFullLogs(!showFullLogs)}
                  className="flex items-center space-x-1 text-xs text-stone-600 hover:text-stone-900 font-medium cursor-pointer"
                >
                  <Terminal className="w-3.5 h-3.5 text-stone-500" />
                  <span>{showFullLogs ? 'Hide detailed execution log' : `View execution log (${progressState.logs.length} recent events)`}</span>
                </button>
                <a
                  href="/api/requirements/diagnostic-log"
                  download
                  className="flex items-center space-x-1 text-xs text-amber-800 hover:text-amber-950 font-semibold"
                  title="Download the complete persistent installer log"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Download full log</span>
                </a>
              </div>

              {showFullLogs && (
                <div className="terminal-surface bg-stone-900 text-stone-200 p-3 rounded-lg font-mono text-[11px] max-h-40 overflow-y-auto space-y-1 border border-stone-800">
                  {progressState.logs.map((line, idx) => (
                    <div key={idx} className="leading-tight">
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 bg-stone-50 border-t border-stone-200 flex flex-wrap gap-3 items-center justify-between">
          <div className="text-xs text-stone-500">
            {report?.statusColor === 'green' ? (
              <span className="text-emerald-700 font-medium flex items-center space-x-1">
                <CheckCircle2 className="w-3.5 h-3.5 inline text-emerald-600" />
                <span>Workflow ready.</span>
              </span>
            ) : report?.statusColor === 'yellow' ? (
              <span className="text-amber-700 font-medium flex items-center space-x-1">
                <Zap className="w-3.5 h-3.5 inline text-amber-600" />
                <span>Ready with an optional improvement.</span>
              </span>
            ) : (
              <span className="text-red-700 font-medium flex items-center space-x-1">
                <AlertTriangle className="w-3.5 h-3.5 inline text-red-600" />
                <span>{report?.needsAttentionCount || 0} component(s) need attention.</span>
              </span>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-stone-300 text-stone-700 hover:bg-stone-100 font-medium text-xs transition-colors cursor-pointer"
            >
              Close
            </button>
            <button
              id="btn-requirements-install-repair"
              onClick={handleInstallRepair}
              disabled={isLoading || busy}
              className="flex items-center space-x-1.5 px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
            >
              <Wrench className="w-3.5 h-3.5" />
              <span>{pytorchFlavor === 'keep' ? 'Install selected missing tools' : 'Install selected build & tools'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

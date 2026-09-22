import React, { useMemo, useState } from 'react';
import { AudiobookJob } from '../types';
import { ArchiveX, Check, Database, FileText, FolderX, ShieldAlert, Trash2 } from 'lucide-react';

export type CleanupType =
  | 'cache'
  | 'orphans'
  | 'logs'
  | 'all-working'
  | 'project-temp'
  | 'project-intermediate'
  | 'project-source';

interface CleanupModalProps {
  job: AudiobookJob | null;
  onClose: () => void;
  onCleanup: (cleanupType: CleanupType, confirmation?: string) => Promise<void>;
}

interface CleanupChoice {
  id: CleanupType;
  title: string;
  description: string;
  destructive?: boolean;
  icon: React.ComponentType<{ className?: string }>;
}

const generalChoices: CleanupChoice[] = [
  {
    id: 'cache',
    title: 'Clear cache and temporary files',
    description: 'Removes disposable processing files. They will be recreated when needed.',
    icon: Database,
  },
  {
    id: 'orphans',
    title: 'Remove files from deleted books',
    description: 'Finds SwissMouse working folders that no longer belong to a saved book project.',
    icon: FolderX,
  },
  {
    id: 'logs',
    title: 'Clear saved technical logs',
    description: 'Removes older troubleshooting logs. Project activity shown inside saved books is kept.',
    icon: FileText,
  },
  {
    id: 'all-working',
    title: 'Clear all working files',
    description: 'Removes every book’s imported copies, generated audio, transcripts, cache, and orphaned working folders.',
    destructive: true,
    icon: ArchiveX,
  },
];

export const CleanupModal: React.FC<CleanupModalProps> = ({ job, onClose, onCleanup }) => {
  const choices = useMemo<CleanupChoice[]>(() => {
    if (!job) return generalChoices;
    return [
      ...generalChoices,
      {
        id: 'project-temp',
        title: 'Remove temporary files for this book',
        description: 'Removes interrupted and superseded processing files while keeping the current review audio and transcript.',
        icon: Trash2,
      },
      {
        id: 'project-intermediate',
        title: 'Remove generated files for this book',
        description: 'Removes generated audio and transcript data. Imported source copies and book details stay available.',
        icon: Database,
      },
      {
        id: 'project-source',
        title: 'Remove imported and generated files for this book',
        description: 'Removes SwissMouse-managed source copies and working files. Original source files and finished exports stay safe.',
        destructive: true,
        icon: FolderX,
      },
    ];
  }, [job]);

  const [cleanupType, setCleanupType] = useState<CleanupType>('cache');
  const [confirmationInput, setConfirmationInput] = useState('');
  const [isCleaning, setIsCleaning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const selected = choices.find(choice => choice.id === cleanupType) || choices[0];
  const requiredPhrase = cleanupType === 'all-working'
    ? 'CLEAR ALL WORKING FILES'
    : cleanupType === 'project-source' && job
      ? `PURGE ${job.name}`
      : null;

  const executeCleanup = async () => {
    setErrorMsg(null);
    if (requiredPhrase && confirmationInput.trim() !== requiredPhrase) {
      setErrorMsg(`Type '${requiredPhrase}' exactly to confirm.`);
      return;
    }
    setIsCleaning(true);
    try {
      await onCleanup(cleanupType, confirmationInput.trim());
      onClose();
    } catch (error: any) {
      setErrorMsg(error.message || 'Cleanup could not be completed.');
    } finally {
      setIsCleaning(false);
    }
  };

  const renderChoice = (choice: CleanupChoice) => {
    const Icon = choice.icon;
    const isSelected = cleanupType === choice.id;
    return (
      <label
        key={choice.id}
        className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${
          isSelected
            ? choice.destructive ? 'border-red-400 bg-red-50' : 'border-amber-500 bg-amber-50/60'
            : 'border-stone-200 hover:bg-stone-50'
        }`}
      >
        <input
          type="radio"
          name="cleanupType"
          checked={isSelected}
          onChange={() => { setCleanupType(choice.id); setConfirmationInput(''); setErrorMsg(null); }}
          className="mt-1 text-amber-700 focus:ring-amber-500"
        />
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${choice.destructive ? 'text-red-600' : 'text-stone-500'}`} />
        <span className="min-w-0">
          <span className={`block text-sm font-semibold ${choice.destructive ? 'text-red-900' : 'text-stone-900'}`}>{choice.title}</span>
          <span className="mt-0.5 block text-[11px] leading-relaxed text-stone-500">{choice.description}</span>
        </span>
      </label>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 p-4 backdrop-blur-xs">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-stone-200 bg-white p-5 shadow-xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-base font-bold text-stone-900">
              <Trash2 className="h-5 w-5 text-amber-700" />
              <span>Free up space</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-stone-600">Choose one cleanup task. SwissMouse only removes files it manages.</p>
          </div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700" aria-label="Close">✕</button>
        </div>

        <div className="mt-5 space-y-5">
          <section>
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-stone-400">General cleanup</h3>
            <div className="grid gap-2 sm:grid-cols-2">{generalChoices.map(renderChoice)}</div>
          </section>

          {job && (
            <section>
              <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-stone-400">Current book · {job.name}</h3>
              <div className="space-y-2">{choices.slice(generalChoices.length).map(renderChoice)}</div>
            </section>
          )}

          {requiredPhrase && (
            <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              <div className="flex items-center gap-1.5 font-semibold"><ShieldAlert className="h-4 w-4 text-red-600" />Confirm permanent removal</div>
              <p className="text-[11px]">Type <strong className="font-mono">{requiredPhrase}</strong> to continue.</p>
              <input
                type="text"
                value={confirmationInput}
                onChange={event => setConfirmationInput(event.target.value)}
                placeholder={requiredPhrase}
                className="w-full rounded-lg border border-red-300 bg-white px-3 py-2 font-mono text-xs text-stone-900"
              />
            </div>
          )}

          {errorMsg && <div className="rounded-lg bg-red-100 p-2.5 text-xs font-medium text-red-700">{errorMsg}</div>}

          <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-[11px] leading-relaxed text-stone-600">
            <div className="mb-1 flex items-center gap-1.5 font-semibold text-stone-800"><Check className="h-3.5 w-3.5 text-emerald-600" />Always kept safe</div>
            Original audio outside SwissMouse, finished exports, book details and chapter edits, installed speech models, and application tools are never removed. Cleanup pauses if importing or processing is active.
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50">Cancel</button>
          <button
            onClick={executeCleanup}
            disabled={isCleaning}
            className={`rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:cursor-wait disabled:opacity-60 ${selected.destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-700 hover:bg-amber-800'}`}
          >
            {isCleaning ? 'Cleaning up…' : selected.title}
          </button>
        </div>
      </div>
    </div>
  );
};

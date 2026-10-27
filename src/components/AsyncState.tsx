

/** Shared first-load, empty and recoverable-error presentation. Keep loaded content for background work. */
export function AsyncState({ kind, title, message, onRetry }: {
  kind: 'loading' | 'empty' | 'error'; title: string; message?: string; onRetry?: () => void;
}) {
  return <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-6 text-center text-stone-800" role={kind === 'error' ? 'alert' : 'status'} aria-busy={kind === 'loading'}>
    {kind === 'loading' && <div className="startup-spinner mx-auto" aria-hidden="true" />}
    <p className="font-semibold">{title}</p>
    {message && <p className="max-w-xl text-sm [overflow-wrap:anywhere]">{message}</p>}
    {kind === 'error' && onRetry && <button type="button" onClick={onRetry} className="rounded-lg border border-stone-300 px-4 py-2 font-semibold">Try again</button>}
  </div>;
}

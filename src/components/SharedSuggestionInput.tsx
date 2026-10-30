import { useEffect, useId, useRef, useState } from 'react';
import type { PickerSelection, Suggestion } from '../../packages/sdk/suggestions';
interface Page {
    items: Suggestion[];
    selected: Suggestion[];
    nextCursor?: string;
    indexing?: boolean;
}
export function SharedSuggestionInput({ id, jobId, providerId, fieldId, value, onChange, onSelection, className, placeholder }: {
    id: string;
    jobId: string;
    providerId: string;
    fieldId: string;
    value: string;
    onChange: (value: string) => void;
    onSelection: (selection: PickerSelection | undefined) => void;
    className?: string;
    placeholder?: string;
}) {
    const listId = useId(), generation = useRef(0);
    const [config, setConfig] = useState<{
        enabled: boolean;
        contextResourceIds: string[];
    }>({ enabled: false, contextResourceIds: [] });
    const [page, setPage] = useState<Page>({ items: [], selected: [] }), [cursor, setCursor] = useState<string>(), [refresh, setRefresh] = useState(0), [error, setError] = useState(''), [loading, setLoading] = useState(false);
    useEffect(() => {
        const controller = new AbortController();
        setConfig({ enabled: false, contextResourceIds: [] });
        void fetch('/api/information-directory/config?jobId=' + encodeURIComponent(jobId), { signal: controller.signal }).then(r => r.json()).then(data => { if (!controller.signal.aborted)
            setConfig(data); }).catch(() => { });
        return () => controller.abort();
    }, [jobId]);
    useEffect(() => {
        const sequence = ++generation.current, controller = new AbortController();
        if (!config.enabled)
            return () => controller.abort();
        setLoading(true);
        setError('');
        const timer = window.setTimeout(async () => {
            try {
                const request = { providerId, fieldId, query: value, limit: 20, contextResourceIds: config.contextResourceIds, ...(cursor ? { cursor } : {}) };
                const response = await fetch('/api/information-directory/suggestions?request=' + encodeURIComponent(JSON.stringify(request)), { signal: controller.signal });
                const result = await response.json();
                if (!response.ok)
                    throw new Error(result.error || 'Suggestions could not be loaded.');
                if (!controller.signal.aborted && sequence === generation.current) {
                    setPage(result);
                    setLoading(false);
                }
            }
            catch (cause) {
                if (!controller.signal.aborted && sequence === generation.current) {
                    setLoading(false);
                    setError(cause instanceof Error ? cause.message : 'Suggestions could not be loaded.');
                }
            }
        }, 180);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [config, providerId, fieldId, value, cursor, refresh]);
    const choose = (item: Suggestion) => { setCursor(undefined); onChange(item.value); onSelection({ receipt: crypto.randomUUID(), key: item.key, value: item.value }); };
    return <div className="space-y-1">
    <input form="metadata-fields" id={id} type="text" value={value} className={className} placeholder={placeholder} list={config.enabled ? listId : undefined} autoComplete="off" onChange={event => {
            setCursor(undefined);
            const text = event.target.value;
            onChange(text);
            const match = page.items.find(item => item.label === text);
            onSelection(match ? { receipt: crypto.randomUUID(), key: match.key, value: match.value } : undefined);
            setPage({ items: [], selected: [] });
        }}/>
    {config.enabled && <><datalist id={listId}>{page.items.map(item => <option key={item.key} value={item.label}>{item.reason}</option>)}</datalist>
      <details className="text-xs"><summary className="cursor-pointer">Series suggestions</summary>
        <p className="text-[11px] text-stone-500">Recent means selected and saved here. Author-related choices use matching saved names. Clear the field to see these choices.</p>
        <div className="mt-1 flex flex-wrap gap-1">{page.items.map(item => <button type="button" disabled={loading} key={item.key} title={item.detail} onClick={() => choose(item)} className="rounded border border-stone-300 px-2 py-1 disabled:opacity-50">{item.label} <span className="text-stone-500">· {item.reason}</span></button>)}</div>
        {page.nextCursor && <button type="button" disabled={loading} onClick={() => setCursor(page.nextCursor)} className="mt-1 underline">More suggestions</button>}
        <button type="button" disabled={loading} className="ml-2 underline" onClick={async () => {
                try {
                    const response = await fetch('/api/information-directory/history/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
                    if (!response.ok)
                        throw new Error((await response.json()).error || 'History could not be cleared.');
                    setCursor(undefined);
                    setRefresh(n => n + 1);
                }
                catch (cause) {
                    setError(cause instanceof Error ? cause.message : 'History could not be cleared.');
                }
            }}>Clear suggestion history</button>
      </details>
      {loading && <p role="status" className="text-xs text-stone-500">Loading suggestions…</p>}
      {page.indexing && <p role="status" className="text-xs text-stone-500">Suggestions are still indexing.</p>}
      {error && <p role="status" className="text-xs text-amber-800">{error} Your text is still editable.</p>}
    </>}
  </div>;
}

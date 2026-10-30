import type { Express } from 'express';
import type { CatalogService } from './catalog-service';
import type { DurableProjectStore } from './durable-project-store';
import type { SelectionCommit } from '../packages/sdk/suggestions';
import { resourceId } from './catalog-store';
import { valueKey } from './information-history';
import { AudiobookCommandError } from '../packages/audiobooks/src/project-service';
export function prepareSeriesSelection(input: unknown, metadata: {
    series?: string;
}, project: {
    id: string;
}): SelectionCommit {
    const value = input as any;
    if (!value || Object.keys(value).some(key => !['receipt', 'key', 'value'].includes(key)) || typeof value.receipt !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(value.receipt) || typeof value.value !== 'string' || !value.value.trim() || value.value.length > 1000 || value.value !== metadata.series || value.key !== valueKey('audiobooks.suggest-series', 'audiobooks.series', value.value))
        throw new AudiobookCommandError(400, 'The selected series must match the metadata being saved.');
    return { receipt: value.receipt, providerId: 'audiobooks.suggest-series', fieldId: 'audiobooks.series', key: value.key, value: value.value, label: value.value, valueKind: 'text', contextResourceIds: [resourceId('audiobooks:work', project.id)], committedAt: Date.now() };
}
/** Host-owned pilot composition. Generic queries never receive project payloads or profile IDs. */
export function registerInformationDirectoryRoutes(app: Express, catalog: CatalogService, source: DurableProjectStore) {
    const enabled = process.env.SWISSMOUSE_INFORMATION_DIRECTORY === '1';
    let flushing: Promise<boolean> | undefined;
    const flush = () => {
        if (flushing)
            return flushing;
        flushing = (async () => {
            if (!enabled)
                return false;
            try {
                for (const row of source.selectionOutbox()) {
                    await catalog.call('informationSelection', JSON.parse(String(row.payload)));
                    source.acknowledgeSelection(String(row.receipt));
                }
                return source.selectionOutbox().length > 0;
            }
            catch {
                return true;
            } // Canonical save succeeded; retain its queue and report pending history.
        })();
        const current = flushing;
        void current.finally(() => { if (flushing === current)
            flushing = undefined; });
        return current;
    };
    app.get('/api/information-directory/config', (req, res) => {
        if (typeof req.query.jobId !== 'string' || req.query.jobId.length > 200) {
            res.status(400).json({ error: 'Expected a bounded job ID.' });
            return;
        }
        res.json({ enabled, contextResourceIds: enabled ? [resourceId('audiobooks:work', req.query.jobId)] : [] });
    });
    if (enabled) {
        const timer = setInterval(() => { void flush(); }, 1000);
        timer.unref();
        app.get('/api/information-directory/suggestions', async (req, res) => {
            try {
                if (Object.keys(req.query).some(k => k !== 'request') || typeof req.query.request !== 'string' || req.query.request.length > 12000)
                    throw new Error('Invalid suggestion request.');
                const result = await catalog.call('informationSuggestions', JSON.parse(req.query.request));
                res.json(result);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                res.status(/changed/.test(message) ? 409 : 400).json({ error: message });
            }
        });
        app.post('/api/information-directory/history/clear', async (req, res) => {
            if (req.body && Object.keys(req.body).length) {
                res.status(400).json({ error: 'History belongs to the current local profile.' });
                return;
            }
            if (await flush()) {
                res.status(503).json({ error: 'A saved selection is still pending. Retry clearing history after delivery resumes.' });
                return;
            }
            try {
                res.json(await catalog.call('informationClearHistory'));
            }
            catch {
                res.status(503).json({ error: 'History could not be cleared.' });
            }
        });
    }
    return flush;
}

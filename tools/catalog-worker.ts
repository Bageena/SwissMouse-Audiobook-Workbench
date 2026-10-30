import { parentPort, workerData } from 'node:worker_threads';
import { CatalogStore } from './catalog-store';
import { observeCatalogProject } from './catalog-availability';

const store = workerData.observe ? undefined : new CatalogStore(workerData.file);
const methods = new Set(['beginSync','upsertProjects','endSync','query','resources','getResource','relations','selection','selectionPage','selectionMembers','collections','saveCollection','collectionAffectedProjects','collectionMembershipRows','suggestions','membershipSuggestions','revision','checkpoint','applyChanges','maintainMatches','matches','informationAdvance','informationStatus','informationPage','informationSuggestions','informationSelection','informationClearHistory']);
parentPort!.on('message', ({ id, method, args }) => {
  try {
    if (workerData.observe) {
      if (method !== 'observe') throw new Error('Unknown observation operation.');
      const result = args[0].map((record: any) => ({ ...observeCatalogProject(record), observation: undefined }));
      parentPort!.postMessage({ id,result }); return;
    }
    if (!methods.has(method)) throw new Error('Unknown catalog operation.');
    const result = (store![method as keyof CatalogStore] as Function).apply(store,args);
    parentPort!.postMessage({ id,result });
  } catch (error) { parentPort!.postMessage({ id,error: error instanceof Error ? error.message : String(error) }); }
});

import { createModuleRegistry } from '../core/modules';
import { audiobookManifest } from './audiobooks/manifest';
import { BookFiles } from '../components/BookFiles';
import { LibraryManager } from '../components/LibraryManager';
import { Step1MergeDetect } from '../components/Step1MergeDetect';
import { Step2ChapterReview } from '../components/Step2ChapterReview';
import { Step3Metadata } from '../components/Step3Metadata';
import { Step4Export } from '../components/Step4Export';
import { Step5Validate } from '../components/Step5Validate';
import { audiobookPanels } from '../../packages/audiobooks/src/workspace-contributions';
import { registerPanel } from '../workspace/panels';
import { activateAudiobookPreferences } from './audiobooks/preferences';

const registry = createModuleRegistry();
/** Temporary compiled-in composition adapter, separate from installed module activation. */
export const audiobookModule = { manifest: audiobookManifest, screens: {
  BookFiles, LibraryManager, Step1MergeDetect, Step2ChapterReview, Step3Metadata, Step4Export, Step5Validate,
} };
let leases = 0;
let deactivate: (() => void) | undefined;
export function activateBuiltInAudiobooks(): () => void {
  if (!leases) {
    const remove: (() => void)[] = [];
    try {
      const registration = registry.register(audiobookManifest, audiobookModule.screens);
      remove.push(registration.unregister);
      remove.push(activateAudiobookPreferences());
      for (const panel of audiobookPanels) remove.push(registerPanel(panel));
      deactivate = () => { for (const cleanup of remove.reverse()) cleanup(); };
    } catch (error) {
      for (const cleanup of remove.reverse()) cleanup();
      throw error;
    }
  }
  leases++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--leases === 0) { deactivate?.(); deactivate = undefined; }
  };
}
export const listBuiltInModules = registry.list;

import { createModuleRegistry } from '../core/modules';
import { audiobookManifest } from './audiobooks/manifest';
import { BookFiles } from '../components/BookFiles';
import { LibraryManager } from '../components/LibraryManager';
import { Step1MergeDetect } from '../components/Step1MergeDetect';
import { Step2ChapterReview } from '../components/Step2ChapterReview';
import { Step3Metadata } from '../components/Step3Metadata';
import { Step4Export } from '../components/Step4Export';
import { Step5Validate } from '../components/Step5Validate';

const registry = createModuleRegistry();
export const audiobookModule = registry.register(audiobookManifest, {
  BookFiles, LibraryManager, Step1MergeDetect, Step2ChapterReview, Step3Metadata, Step4Export, Step5Validate,
});
export const listBuiltInModules = registry.list;

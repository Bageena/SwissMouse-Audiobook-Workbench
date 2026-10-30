import { createPreferencesRegistry, corePreferenceSections } from './registry';
import type { WorkbenchConfig } from '../types';
/** Temporary legacy config binding. The generic registry has no audiobook/config dependency. */
export const preferencesRegistry=createPreferencesRegistry<WorkbenchConfig>();
preferencesRegistry.activate('core',corePreferenceSections);

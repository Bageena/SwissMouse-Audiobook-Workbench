import { preferencesRegistry } from '../../preferences/legacy';
import { requirementsRegistry } from '../../preferences/requirements';
import { audiobookPreferenceSections } from '../../../packages/audiobooks/src/preferences';
import { audiobookRequirementDetails } from '../../../packages/audiobooks/src/requirement-details';
import { featureRequirements } from '../../../packages/audiobooks/src/feature-dependencies';
/** Temporary host composition adapter; definitions themselves use only the public SDK. */
export function activateAudiobookPreferences() {
  const removeSections=preferencesRegistry.activate('audiobooks',audiobookPreferenceSections);
  try {
    const removeRequirements=requirementsRegistry.activate('audiobooks',audiobookRequirementDetails,Object.fromEntries(Object.entries(featureRequirements).map(([id,tools])=>['audiobooks.'+id,tools])));
    return()=>{removeRequirements();removeSections();};
  } catch(error){removeSections();throw error;}
}

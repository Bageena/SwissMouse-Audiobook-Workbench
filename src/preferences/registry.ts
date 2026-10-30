export { createPreferencesRegistry, matchesPreference } from '../../packages/sdk/preferences';
export type { PreferenceContext, PreferenceSection, PreferenceField } from '../../packages/sdk/preferences';
export const preferenceCategories=[{id:'appearance',title:'Appearance'},{id:'storage',title:'Files & storage'},{id:'requirements',title:'Requirements'},{id:'modules',title:'Modules'}] as const;
export const corePreferenceSections=[
{id:'core.modules',owner:'core',category:'modules',title:'Installed modules',description:'Install, enable, disable, remove and open trusted module packages',keywords:['extensions','plugins']},
{id:'core.appearance',owner:'core',category:'appearance',title:'Appearance / Theme',description:'Themes, custom themes and player ambient glow',keywords:['colors','palette','light','dark']},
{id:'core.requirements',owner:'core',category:'requirements',title:'Requirements',description:'Requirements declared by active tools and modules, with installation status and licenses'},
];

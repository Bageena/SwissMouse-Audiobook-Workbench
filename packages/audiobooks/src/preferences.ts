import type { PreferenceSection } from '../../sdk/preferences';
/** Data-only declarations. The legacy editor supplies the config adapter until full package loading. */
export const audiobookPreferenceSections:readonly PreferenceSection<any>[]=[
  {id:'audiobooks.library',owner:'audiobooks',category:'audiobooks',title:'Audiobook library',description:'Inbox, Library, folder structure, sidecars and cover files'},
  {id:'audiobooks.tags',owner:'audiobooks',category:'audiobooks',title:'Manage Quick Tags',description:'Metadata suggestions and Quick Add categories'},
  {id:'audiobooks.processing',owner:'audiobooks',category:'audiobooks',title:'Processing defaults',description:'Faster Transcription, speech-recognition profile, chapter lead-in and M4B audio quality',keywords:['bitrate','stereo','mono','model','Whisper']},
  {id:'audiobooks.storage',owner:'audiobooks',category:'storage',title:'Processing storage',description:'PCM cache retention and cleanup policy'},
  {id:'audiobooks.maintenance',owner:'audiobooks',category:'storage',title:'Library maintenance',description:'Rebuild library indexes and check folders'},
];

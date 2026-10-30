export const coverPresets = {
  Midnight: ['#142440', '#493463', '#ffffff'],
  Ember: ['#4b1631', '#a54b20', '#ffffff'],
  Forest: ['#214c3e', '#091c19', '#ffffff'],
  Ocean: ['#176979', '#102340', '#ffffff'],
  Parchment: ['#f5e8ce', '#c7a479', '#302519'],
  Noir: ['#383b40', '#08090c', '#ffffff'],
  Royal: ['#433888', '#142c61', '#ffffff'],
  Mist: ['#8495a5', '#e0e5e9', '#18232e'],
} as const;

export interface CoverDesign {
  version: 1;
  background: 'gradient' | 'solid' | 'image';
  preset: keyof typeof coverPresets;
  color: string;
  image?: string;
  layout: 'classic' | 'centered' | 'minimal';
  title: string;
  author: string;
  narrator: string;
  showAuthor: boolean;
  showNarrator: boolean;
}

/** Local, deterministic cover artwork. No network fonts or image services. */
export const COVER_SIZE = 2000;
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

export function defaultCoverDesign(metadata: { title: string; author: string; narrator: string }): CoverDesign {
  return { version: 1, background: 'gradient', preset: 'Midnight', color: '#213547', layout: 'classic',
    title: metadata.title, author: metadata.author, narrator: metadata.narrator, showAuthor: true, showNarrator: true };
}

export function squareCrop(width: number, height: number) {
  const size = Math.min(width, height);
  return { x: (width - size) / 2, y: (height - size) / 2, size };
}

export function solidTextColor(hex: string) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179 ? '#151515' : '#ffffff';
}

// Break oversized tokens only when they cannot fit on a line of their own.
export function wrapCoverText(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    if (measure(line ? `${line} ${word}` : word) <= width) {
      line = line ? `${line} ${word}` : word;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    for (const character of Array.from(word)) {
      if (line && measure(line + character) > width) { lines.push(line); line = ''; }
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function fitCoverText(text: string, width: number, height: number, maxSize: number,
  measure: (text: string, size: number) => number) {
  for (let size = maxSize; size >= 1; size--) {
    const lines = wrapCoverText(text, width, value => measure(value, size));
    if (lines.length * size * 1.2 <= height && lines.every(line => measure(line, size) <= width)) {
      return { lines, size, height: lines.length * size * 1.2 };
    }
  }
  return { lines: [] as string[], size: 1, height: 0 };
}

export function loadCoverImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to read this image. Choose a PNG, JPEG, or WebP image.'));
    image.src = url;
  });
}

/** Bound the retained background size, and convert it to a safe raster image. */
export async function readCoverBackground(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, or WebP image.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose an image smaller than 20 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = await loadCoverImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = COVER_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image rendering is unavailable in this browser.');
    const crop = squareCrop(image.naturalWidth, image.naturalHeight);
    ctx.drawImage(image, crop.x, crop.y, crop.size, crop.size, 0, 0, COVER_SIZE, COVER_SIZE);
    return canvas.toDataURL('image/jpeg', 0.92);
  } finally { URL.revokeObjectURL(url); }
}

export async function renderCover(canvas: HTMLCanvasElement, design: CoverDesign) {
  const image = design.background === 'image' && design.image ? await loadCoverImage(design.image) : null;
  if (design.background === 'image' && !image) throw new Error('Choose a background image first.');
  canvas.width = canvas.height = COVER_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image rendering is unavailable in this browser.');
  let textColor: string = '#ffffff';
  if (image) {
    const crop = squareCrop(image.naturalWidth, image.naturalHeight);
    ctx.drawImage(image, crop.x, crop.y, crop.size, crop.size, 0, 0, COVER_SIZE, COVER_SIZE);
    // Reliable contrast even with busy photos, without depending on image analysis.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
    ctx.fillRect(0, 0, COVER_SIZE, COVER_SIZE);
  } else if (design.background === 'solid') {
    ctx.fillStyle = design.color;
    ctx.fillRect(0, 0, COVER_SIZE, COVER_SIZE);
    textColor = solidTextColor(design.color);
  } else {
    const preset = coverPresets[design.preset];
    const gradient = ctx.createLinearGradient(0, 0, COVER_SIZE, COVER_SIZE);
    gradient.addColorStop(0, preset[0]); gradient.addColorStop(1, preset[1]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, COVER_SIZE, COVER_SIZE);
    textColor = preset[2];
  }
  const minimal = design.layout === 'minimal';
  const family = minimal ? 'Arial, sans-serif' : 'Georgia, serif';
  const measure = (text: string, size: number) => {
    ctx.font = `bold ${size}px ${family}`;
    return ctx.measureText(text).width;
  };
  const title = fitCoverText(design.title, 1640, 760, minimal ? 230 : 210, measure);
  const author = fitCoverText(design.showAuthor ? design.author : '', 1640, 280, Math.min(84, title.size * 0.65), measure);
  const narrator = fitCoverText(design.showNarrator && design.narrator.trim() ? `Narrated by ${design.narrator}` : '', 1640, 200, Math.min(58, title.size * 0.5), measure);
  ctx.fillStyle = textColor;
  ctx.textAlign = minimal ? 'left' : 'center';
  ctx.textBaseline = 'top';
  const x = minimal ? 180 : 1000;
  const draw = (block: typeof title, top: number) => {
    ctx.font = `bold ${block.size}px ${family}`;
    block.lines.forEach((line, i) => ctx.fillText(line, x, top + i * block.size * 1.2));
  };
  const top = design.layout === 'centered' ? (COVER_SIZE - title.height - author.height - 90) / 2 : minimal ? 420 : 230;
  draw(title, top);
  draw(author, top + title.height + 90);
  ctx.globalAlpha = 0.85;
  draw(narrator, 1800 - narrator.height);
  ctx.globalAlpha = 1;
}

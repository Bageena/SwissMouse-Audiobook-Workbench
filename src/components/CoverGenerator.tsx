import React, { useEffect, useRef, useState } from 'react';
import type { AudiobookMetadata, CoverArtInfo } from '../types';
import { COVER_SIZE, coverPresets, defaultCoverDesign, readCoverBackground, renderCover, type CoverDesign } from '../utils/coverGenerator';

interface Props {
  metadata: AudiobookMetadata;
  onCancel: () => void;
  onUse: (cover: CoverArtInfo) => Promise<void>;
}

export function CoverGenerator({ metadata, onCancel, onUse }: Props) {
  const [design, setDesign] = useState<CoverDesign>(() => metadata.cover?.design || defaultCoverDesign(metadata));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingImage, setLoadingImage] = useState(false);
  const [ready, setReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const imageRequest = useRef(0);
  const update = (patch: Partial<CoverDesign>) => { setReady(false); setDesign(previous => ({ ...previous, ...patch })); };

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.showModal();
    return () => { imageRequest.current++; previousFocus?.focus(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError('');
    // Render offscreen so a stale asynchronous image load cannot replace a newer preview.
    const canvas = document.createElement('canvas');
    renderCover(canvas, design).then(() => {
      if (cancelled || !canvasRef.current) return;
      canvasRef.current.width = canvasRef.current.height = COVER_SIZE;
      canvasRef.current.getContext('2d')?.drawImage(canvas, 0, 0);
      setReady(true);
    }).catch((err: Error) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [design]);

  const chooseImage = async (file?: File) => {
    if (!file) return;
    const request = ++imageRequest.current;
    setLoadingImage(true);
    setError('');
    try {
      const image = await readCoverBackground(file);
      if (request === imageRequest.current) update({ image, background: 'image' });
    } catch (err) {
      if (request === imageRequest.current) setError((err as Error).message);
    } finally { if (request === imageRequest.current) setLoadingImage(false); }
  };

  const useCover = async () => {
    if (!ready || !canvasRef.current) return;
    setBusy(true);
    setError('');
    try {
      const url = canvasRef.current.toDataURL('image/jpeg', 0.94);
      await onUse({ source: 'generated', url, filename: 'generated-cover.jpg', mimeType: 'image/jpeg',
        width: COVER_SIZE, height: COVER_SIZE, sizeBytes: Math.floor((url.length - url.indexOf(',') - 1) * 3 / 4), design });
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const inputClass = 'mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900';
  return (
    <dialog ref={dialogRef} aria-labelledby="cover-generator-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}
      className="m-auto w-[min(900px,calc(100%-2rem))] max-h-[90vh] overflow-y-auto rounded-xl border border-stone-200 bg-white p-5 text-stone-900 shadow-xl backdrop:bg-black/60">
      <h2 id="cover-generator-title" className="text-lg font-bold">Generate Cover</h2>
      <p className="mt-1 text-sm text-stone-500">Create artwork locally. Text edits here only change the cover.</p>
      <div className="mt-5 grid gap-6 sm:grid-cols-2">
        <div>
          <canvas ref={canvasRef} aria-label="Generated audiobook cover preview" role="img" className={`aspect-square w-full rounded-lg shadow-md ${ready ? '' : 'opacity-40'}`} />
          <p className="mt-3 text-center text-xs text-stone-500">2000 × 2000 · JPEG</p>
        </div>
        <fieldset disabled={busy} className="min-w-0 space-y-3">
          <label className="block text-sm font-medium">Background
            <select className={inputClass} value={design.background} onChange={e => update({ background: e.target.value as CoverDesign['background'] })}>
              <option value="gradient">Gradient</option><option value="solid">Solid Color</option><option value="image">Custom Image</option>
            </select>
          </label>
          {design.background === 'gradient' && <label className="block text-sm font-medium">Preset
            <select className={inputClass} value={design.preset} onChange={e => update({ preset: e.target.value as CoverDesign['preset'] })}>
              {Object.keys(coverPresets).map(name => <option key={name}>{name}</option>)}
            </select>
          </label>}
          {design.background === 'solid' && <label className="block text-sm font-medium">Background color
            <input aria-label="Background color" type="color" className="mt-1 block h-10 w-full cursor-pointer" value={design.color} onChange={e => update({ color: e.target.value })} />
          </label>}
          {design.background === 'image' && <label className="block text-sm font-medium">Background image
            <input type="file" accept="image/jpeg,image/png,image/webp" className={inputClass} onChange={e => { void chooseImage(e.target.files?.[0]); e.target.value = ''; }} />
            <span className="mt-1 block text-xs font-normal text-stone-500">{loadingImage ? 'Loading image…' : 'Centered square crop with a dark overlay for readable text. PNG, JPEG or WebP, up to 20 MB.'}</span>
          </label>}
          <label className="block text-sm font-medium">Layout
            <select className={inputClass} value={design.layout} onChange={e => update({ layout: e.target.value as CoverDesign['layout'] })}>
              <option value="classic">Classic</option><option value="centered">Centered</option><option value="minimal">Minimal</option>
            </select>
          </label>
          {(['title', 'author', 'narrator'] as const).map(field => <label key={field} className="block text-sm font-medium">
            {field[0].toUpperCase() + field.slice(1)}
            <input className={inputClass} maxLength={field === 'title' ? 500 : 300} value={design[field]} onChange={e => update({ [field]: e.target.value })} />
          </label>)}
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">Advanced</summary>
            <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={design.showAuthor} onChange={e => update({ showAuthor: e.target.checked })} />Show author</label>
            <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={design.showNarrator} onChange={e => update({ showNarrator: e.target.checked })} />Show narrator</label>
          </details>
        </fieldset>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-rose-700">{error}</p>}
      <div className="mt-5 flex justify-end gap-3 border-t border-stone-200 pt-4">
        <button type="button" disabled={busy} onClick={onCancel} className="rounded-lg border border-stone-300 px-4 py-2 text-sm disabled:opacity-50">Cancel</button>
        <button type="button" disabled={busy} onClick={() => { imageRequest.current++; setLoadingImage(false); setReady(false); setDesign(defaultCoverDesign(metadata)); }} className="rounded-lg border border-stone-300 px-4 py-2 text-sm disabled:opacity-50">Reset</button>
        <button type="button" disabled={busy || loadingImage || !ready} onClick={() => void useCover()} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Use Cover'}</button>
      </div>
    </dialog>
  );
}

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

export function ChapterResetDialog({ onConfirm, onClose }: { onConfirm: () => void; onClose: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const titleId = useId(), descriptionId = useId();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel.current?.focus();
    return () => previous?.focus();
  }, []);
  return createPortal(<div className="fixed inset-0 z-[10000] flex items-center justify-center bg-stone-900/50 p-4"
    onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
      className="w-full max-w-md rounded-xl border border-stone-300 bg-white p-5 shadow-xl space-y-4"
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
        if (event.key === 'Tab') { event.preventDefault(); (document.activeElement === cancel.current ? confirm : cancel).current?.focus(); }
      }}>
      <h2 id={titleId} className="font-bold">Reset to default chapters?</h2>
      <p id={descriptionId} className="text-sm">Replace your current chapter edits, including saved edits, with the original detected or source chapter list. Audio files stay unchanged. Save the chapter list to keep the reset.</p>
      <div className="flex justify-end gap-2">
        <button ref={cancel} type="button" onClick={onClose} className="rounded border border-stone-300 px-3 py-2">Cancel</button>
        <button ref={confirm} type="button" onClick={onConfirm} className="paper-action-dark rounded border border-stone-300 px-3 py-2">Reset chapters</button>
      </div>
    </div>
  </div>, document.body);
}

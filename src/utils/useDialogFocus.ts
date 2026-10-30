import { useEffect, useRef } from 'react';

/** Modal keyboard behavior shared by settings and runtime tools. */
export function useDialogFocus(onDismiss: () => void, enabled = true) {
  const ref = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onDismiss); dismiss.current = onDismiss;
  useEffect(() => {
    if (!enabled) return;
    const dialog = ref.current; if (!dialog) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter(node => node.getClientRects().length > 0);
    (focusable()[0] || dialog).focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') { event.preventDefault(); dismiss.current(); }
      if (event.key !== 'Tab') return;
      const controls = focusable(), first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last!.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      if (trigger?.isConnected && trigger !== document.body) trigger.focus();
      else document.querySelector<HTMLElement>('[aria-label="Tools and settings"]')?.focus();
    };
  }, [enabled]);
  return ref;
}

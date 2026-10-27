/** Reveal a laid-out panel without animating height or scaling text.
 * The header stays visible while a simple clip opens downwards beneath it. */
export function revealPanel(element: HTMLElement, header?: HTMLElement): Animation | undefined {
  const view = element.ownerDocument.defaultView;
  if (!element.animate || view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const bounds = element.getBoundingClientRect();
  const headerBottom = header ? header.getBoundingClientRect().bottom - bounds.top : 56;
  const hiddenHeight = Math.max(0, bounds.height - Math.max(0, headerBottom));
  if (hiddenHeight < 2 || !bounds.width) return;
  const configured = parseFloat(view?.getComputedStyle(element).getPropertyValue('--sm-panel-reveal-duration') || '180');
  if (configured === 0) return;
  const duration = Number.isFinite(configured) ? Math.max(100, Math.min(240, configured)) : 180;
  // Negative insets retain floating controls and side shadows. No fill mode:
  // finishing or cancellation restores the normal unclipped panel.
  return element.animate([
    { clipPath: `inset(-40px -32px ${hiddenHeight}px -32px)` },
    { clipPath: 'inset(-40px -32px -32px -32px)' },
  ], { duration, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' });
}

export type PanelPosition = { left: number; top: number; width: number; height: number };
const placementAnimations = new WeakMap<HTMLElement, Animation>();
export function cancelPanelSettle(element: HTMLElement) {
  placementAnimations.get(element)?.cancel();
  placementAnimations.delete(element);
}
/** One layout read after placement; only compositor properties animate. Long
 * moves settle over the last 96px so content never flies across the workspace. */
export function settlePanel(element: HTMLElement, before: PanelPosition): Animation | undefined {
  cancelPanelSettle(element);
  const view = element.ownerDocument.defaultView;
  if (!element.animate || view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  element.querySelector?.(':scope > .desktop-merge-receipt')?.animate?.([{ opacity: .8 }, { opacity: 0 }], { duration: 260, easing: 'ease-out' });
  const after = element.getBoundingClientRect();
  if (!after.width || !after.height) return;
  const dx = Math.max(-96, Math.min(96, before.left - after.left));
  const dy = Math.max(-96, Math.min(96, before.top - after.top));
  if (Math.abs(dx) + Math.abs(dy) < 1 && Math.abs(before.width - after.width) + Math.abs(before.height - after.height) < 1) return;
  const animation = element.animate([
    { transform: `translate3d(${dx}px, ${dy}px, 0)`, opacity: .72 },
    { transform: 'translate3d(0, 0, 0)', opacity: 1 },
  ], { duration: 190, easing: 'cubic-bezier(0.2, 0.75, 0.3, 1)' });
  placementAnimations.set(element, animation);
  const clean = () => { if (placementAnimations.get(element) === animation) placementAnimations.delete(element); };
  animation.addEventListener?.('finish', clean, { once: true });
  animation.addEventListener?.('cancel', clean, { once: true });
  return animation;
}

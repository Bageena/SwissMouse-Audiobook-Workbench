import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { DesktopWindow } from './DesktopWorkspace';
import { PanelOrientationToggle, usePanelOrientation } from './PanelOrientationToggle';
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
export type NavigationItem = {
  id: string; buttonId?: string; label: string; description?: string; icon: React.ReactElement;
  active?: boolean; completed?: boolean; stale?: boolean; disabled?: boolean; onClick: () => void;
};
/** Shared navigation shell; callers supply destinations and retain their own data. */
export function NavigationPanel({ id, title, navigationLabel, items, children, legacyOrientationKey }: {
  id: string; title: string; navigationLabel?: string; items: NavigationItem[]; children?: React.ReactNode; legacyOrientationKey?: string;
}) {
  const { horizontal, setHorizontal } = usePanelOrientation(id, false, legacyOrientationKey);
  const navigation = useRef<HTMLElement>(null);
  const [iconsOnly, setIconsOnly] = useState(false);
  useBrowserLayoutEffect(() => {
    const nav = navigation.current;
    if (!nav) return;
    let frame = 0;
    const measure = () => {
      const compact = [...nav.querySelectorAll<HTMLElement>('.workflow-nav-item')].some(button => {
        const text = button.querySelector<HTMLElement>('.workflow-nav-text');
        if (!text) return false;
        const style = getComputedStyle(button);
        // Measure the full label at its expanded width even while icons are shown.
        const width = button.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 16 - parseFloat(style.columnGap || '8') - (button.children.length > 2 ? 22 : 0);
        if (width < 16) return true;
        const probe = text.cloneNode(true) as HTMLElement;
        probe.setAttribute('aria-hidden', 'true');
        probe.style.cssText = `display:block!important;position:absolute;visibility:hidden;pointer-events:none;width:${width}px;inset:0 auto auto 0;`;
        button.appendChild(probe);
        const lines = [...probe.children].reduce((total, child) => {
          const childStyle = getComputedStyle(child);
          const lineHeight = parseFloat(childStyle.lineHeight) || parseFloat(childStyle.fontSize) * 1.2;
          return total + Math.round(child.getBoundingClientRect().height / lineHeight);
        }, 0);
        probe.remove();
        return lines >= 5;
      });
      setIconsOnly(compact);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(nav);
    nav.querySelectorAll('.workflow-nav-item').forEach(button => observer.observe(button));
    document.fonts?.addEventListener('loadingdone', schedule);
    measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); document.fonts?.removeEventListener('loadingdone', schedule); };
  }, [horizontal, items]);
  return <DesktopWindow id={id} title={title} definitionId="swissmouse.navigation" className={horizontal ? 'workflow-layout-horizontal' : ''}>
    <aside aria-label={title} className="library-navigation workflow-navigation standard-navigation rounded-xl border border-stone-200 bg-white p-2 text-xs">
      <div data-container-heading className="flex min-h-9 w-full items-center gap-2 rounded-lg p-2 font-semibold">
        <PanelOrientationToggle horizontal={horizontal} onChange={() => setHorizontal(!horizontal)} />
        <span className="workspace-panel-title">{title}</span>
      </div>
      <nav ref={navigation} data-icons-only={iconsOnly} aria-label={navigationLabel || title} className="mt-2 space-y-1">{items.map(item => {
        const active = item.active;
        const state = { completed: item.completed, stale: item.stale };
        return <button key={item.id} type="button" id={item.buttonId} title={item.label} aria-label={item.label} aria-current={active ? 'page' : undefined} onClick={item.onClick} disabled={item.disabled} className={`workflow-nav-item flex min-h-10 w-full items-start gap-2 rounded-lg border px-2 py-2 text-left ${active ? 'bg-stone-900 text-white border-stone-900' : 'border-transparent text-stone-700 hover:bg-stone-50'}`}>
          {React.cloneElement(item.icon as React.ReactElement, { className: 'mt-0.5 h-4 w-4 shrink-0' })}<span className="workflow-nav-text min-w-0 flex-1"><span className="block font-semibold">{item.label}</span><span className={`mt-1 block text-[10px] ${active ? 'text-stone-200' : 'text-stone-500'}`}>{item.description}</span>{state.stale && <span className={`mt-1 block text-[10px] font-bold ${active ? 'text-orange-200' : 'text-orange-700'}`}>Needs rerun</span>}</span>{state.completed && !state.stale && <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />}
        </button>;
      })}</nav>

      {children}
    </aside>
  </DesktopWindow>;
}

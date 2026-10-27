
import { useDesktopWorkspace } from './DesktopWorkspace';
import { readStored } from '../utils/libraryWorkspace';
export function usePanelOrientation(id: string, defaultHorizontal = false, legacyKey?: string) {
  const desktop = useDesktopWorkspace();
  const connection = desktop?.connections[id];
  const attached = !!desktop?.groups[id];
  const stored = desktop?.state.panels[id]?.horizontal;
  const horizontal = connection ? connection.side !== 'left' && connection.side !== 'right' : attached ? defaultHorizontal : stored ?? (legacyKey ? readStored<boolean>(legacyKey, defaultHorizontal) : defaultHorizontal);
  return { horizontal, attached, setHorizontal: (value: boolean) => desktop?.setPreferences(id, { horizontal: value }) };
}
export function PanelOrientationToggle({ horizontal, onChange, disabled = false, layoutName = 'navigation' }: { horizontal: boolean; onChange: () => void; disabled?: boolean; layoutName?: string }) {
  const label = `Use ${horizontal ? 'vertical' : 'horizontal'} ${layoutName} layout`;
  return <button type="button" disabled={disabled} aria-label={label} title={label} aria-pressed={horizontal} onClick={onChange} className="navigation-layout-toggle inline-flex h-8 w-8 shrink-0 items-center justify-center">
    <svg aria-hidden="true" viewBox="0 0 32 32" className={`navigation-layout-icon h-6 w-6 ${horizontal ? 'navigation-layout-hotdog' : 'navigation-layout-hamburger'}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {horizontal ? <><path d="M6 22C2 17 9 7 23 6c5 0 7 5 3 10C17 27 10 27 6 22Z" /><path d="m9 20 14-10" /><path d="m11 19 1-3 4 0 1-3 3 0" /></> : <><path d="M5 12C5 3 27 3 27 12Z" /><path d="M5 17h22M5 22h22c0 7-22 7-22 0Z" /></>}
    </svg>
  </button>;
}

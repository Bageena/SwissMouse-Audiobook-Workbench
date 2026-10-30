import * as React from 'react';
import { WorkspacePanel } from '../components/WorkspacePanel';
import { registerPanel } from '../workspace/panels';
import type { BrowserContribution, BrowserSdk, ModulePanelProps } from '../../packages/sdk';

export interface InstalledModule {
  id: string; name: string; version: string; publisher: string;
  installed: boolean; enabled: boolean; active: boolean; restartRequired: boolean; error?: string;
  browser?: string; styles: string[]; panels: { id: string; title: string; operation: string }[];
  assets: Record<string, string>;
}
class ModulePanelBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p role="alert">This module panel could not be displayed. Close it and check its compatible version.</p> : this.props.children; }
}

export function InstalledModulePanel({ module, panelId, resourceId }: { module: InstalledModule; panelId: string; resourceId?: string }) {
  const [Panel, setPanel] = React.useState<React.ComponentType<ModulePanelProps> | null>(null);
  const [data, setData] = React.useState<unknown>();
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const styles: HTMLLinkElement[] = [];
    const cleanup: (() => void)[] = [];
    const panel = module.panels.find(item => item.id === panelId);
    if (!panel || !module.browser || !resourceId) return;
    void (async () => {
      try {
        await Promise.all(module.styles.map(href => new Promise<void>((resolve, reject) => {
          const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href;
          link.onload = () => resolve(); link.onerror = () => reject(new Error('Module stylesheet could not be loaded.'));
          styles.push(link); document.head.appendChild(link);
        })));
        if (disposed) return;
        const implementation = await import(/* @vite-ignore */ module.browser);
        if (disposed) return;
        const sdk: BrowserSdk = Object.freeze({ apiVersion: 1, React, ui: Object.freeze({ Panel: WorkspacePanel }), assetUrl: (name: string) => {
          if (!Object.hasOwn(module.assets, name)) throw new Error('Undeclared module asset.');
          return module.assets[name];
        } });
        const contribution = await implementation.activate(sdk) as BrowserContribution;
        if (disposed) return;
        if (!contribution?.panels || Object.keys(contribution.panels).length !== module.panels.length || module.panels.some(item => typeof contribution.panels[item.id] !== 'function')) throw new Error('Module panel contributions do not match its manifest.');
        for (const item of module.panels) cleanup.push(registerPanel({ id: item.id, name: `${module.name}: ${item.title}`, role: 'parent', module: module.id }));
        const response = await fetch(`/api/modules/${encodeURIComponent(module.id)}/read/${encodeURIComponent(panel.operation)}?resourceId=${encodeURIComponent(resourceId)}`, { signal: controller.signal, cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Module read operation failed.');
        if (!disposed) { setData(result); setPanel(() => contribution.panels[panel.id]); }
      } catch (error) {
        for (const dispose of cleanup.splice(0).reverse()) dispose();
        for (const link of styles) link.remove();
        if (!disposed) setError((error as Error).message);
      }
    })();
    return () => { disposed = true; controller.abort(); for (const dispose of cleanup.reverse()) dispose(); for (const link of styles) link.remove(); };
  }, [module.browser, panelId, resourceId]);
  if (!resourceId) return <p>Open a resource in SwissMouse first, then return to this panel.</p>;
  if (error) return <p role="alert">{error}</p>;
  if (!Panel) return <p role="status">Loading installed panel…</p>;
  return <ModulePanelBoundary><Panel data={data} context={{ resourceId }} /></ModulePanelBoundary>;
}

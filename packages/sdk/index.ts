import type * as React from 'react';

/** Trusted first-party SDK. API 1 read panels remain backward compatible. */
export const moduleApiVersion = 1;
export const sdkVersion = '0.0.2';
export {applicationApiVersion} from './applications';
export type {ApplicationModuleManifest,ApplicationBrowserSdk,ApplicationBrowserContribution} from './applications';
export interface PanelContext { resourceId?: string }
export interface ModulePanelProps { data: unknown; context: PanelContext }
export interface BrowserSdk {
  apiVersion: 1;
  React: typeof React;
  assetUrl: (name: string) => string;
  ui: { Panel: React.ComponentType<{ id: string; title: string; children: React.ReactNode }> };
}
export interface BrowserContribution {
  panels: Record<string, React.ComponentType<ModulePanelProps>>;
}
export interface ServerSdk {
  apiVersion: 1;
  /** Snapshot supplied by the host's temporary legacy-data adapter. */
  readRecord: (id: string) => Promise<Readonly<Record<string, unknown>> | undefined>;
}
export interface ServerContribution {
  reads: Record<string, (context: PanelContext) => Promise<unknown>>;
}
export interface InstalledModuleManifest {
  format: 'swissmouse.module';
  id: string;
  name: string;
  publisher: string;
  version: string;
  apiVersion: 1;
  reactMajor: 18;
  browser: string;
  backend: string;
  styles: string[];
  assets: string[];
  panels: { id: string; title: string; operation: string }[];
  operations: string[];
  /** Every package payload file, including preferred source and notices. */
  files: Record<string, string>;
}

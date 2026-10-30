import type { InstalledModuleManifest } from './index';
import type { RequirementDetails } from './dependencies';
import type * as React from 'react';
export const applicationApiVersion=2;
/** Trusted full-workspace protocol 2. API 1 read-only packages remain separate and supported. */
export interface ApplicationModuleManifest extends Omit<InstalledModuleManifest,'apiVersion'|'backend'> {
  apiVersion:2;backend:string;sdkVersion:'0.0.2';
  application:{
    kind:'node-http-workspace';health:string;prepareRemoval:string;routes:string[];
    requirements:Record<string,RequirementDetails>;
    /** Explicit old absolute artwork URLs, resolved only to declared immutable assets. */
    publicAssets:Record<string,string>;
  };
}
export interface ApplicationModuleStatus {busy?:string;publicationPending?:boolean;historyPending?:boolean}
export interface ApplicationBrowserSdk {apiVersion:2;React:typeof React;openPreferences:()=>void}
export interface ApplicationBrowserContribution {
  Workspace:React.ComponentType;Preferences?:React.ComponentType;Requirements?:React.ComponentType;dispose?:()=>void;
  /** Persist staged edits and stop playback before disabling or updating. False cancels. */
  prepareDeactivate?:()=>Promise<boolean>;
  hasUnsavedPreferences?:()=>boolean;
}

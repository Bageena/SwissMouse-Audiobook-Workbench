import {useEffect,useState} from 'react';
import App from '../../../src/App';
import {DependencyStatusProvider} from '../../../src/dependency-status';
import {activateBuiltInAudiobooks} from '../../../src/modules/audiobooks';
import {ConfigModal} from '../../../src/components/ConfigModal';
import {RequirementsModal} from '../../../src/components/RequirementsModal';
import {getStoredTheme,persistTheme} from '../../../src/theme';
import type {WorkbenchConfig} from '../../../src/types';
import type {ApplicationBrowserSdk,ApplicationBrowserContribution} from '../../sdk/applications';
import '../../../src/index.css';

function Preferences({onDirtyChange}:{onDirtyChange:(dirty:boolean)=>void}){
  const [config,setConfig]=useState<WorkbenchConfig>(),[error,setError]=useState('');
  useEffect(()=>{const abort=new AbortController();void fetch('/api/config',{signal:abort.signal}).then(r=>r.json()).then(setConfig).catch(e=>{if(!abort.signal.aborted)setError(String(e));});return()=>abort.abort();},[]);
  if(error)return <p role="alert">{error}</p>;if(!config)return <p role="status">Loading module preferences…</p>;
  return <ConfigModal embedded onDirtyChange={onDirtyChange} owner="audiobooks" presentation="preferences" initialSection="audiobooks" config={config} theme={getStoredTheme()} customThemes={[]} themeWarnings={[]} isReloadingThemes={false} onThemeChange={persistTheme} onReloadThemes={async()=>{}} onOpenThemesFolder={async()=>{}} onClose={()=>{}} onSaveConfig={async next=>{const response=await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)});const result=await response.json();if(!response.ok)throw new Error(result.error||'Preferences could not be saved.');setConfig(result.config);window.dispatchEvent(new CustomEvent("swissmouse-audiobook-config-saved",{detail:result.config}));return result.config;}} onRebuilt={async()=>{}}/>;
}
/** Full workspace entry; React and ReactDOM resolve to the host-provided runtime. */
export async function activate(sdk:ApplicationBrowserSdk):Promise<ApplicationBrowserContribution>{
  if(sdk.apiVersion!==2||!sdk.React)throw new Error('Full Audiobooks requires browser protocol 2.');
  const remove=activateBuiltInAudiobooks();
  let beforeDeactivate:(()=>Promise<boolean>)|undefined,dirty=false;
  const registerBeforeDeactivate=(prepare:()=>Promise<boolean>)=>{beforeDeactivate=prepare;return()=>{if(beforeDeactivate===prepare)beforeDeactivate=undefined;};};
  const onDirtyChange=(value:boolean)=>{dirty=value;};
  return {Workspace:()=> <DependencyStatusProvider><App hostPreferences={sdk.openPreferences} registerBeforeDeactivate={registerBeforeDeactivate}/></DependencyStatusProvider>,Preferences:()=> <Preferences onDirtyChange={onDirtyChange}/>,Requirements:()=> <RequirementsModal embedded onClose={()=>{}}/>,prepareDeactivate:async()=>beforeDeactivate?beforeDeactivate():true,hasUnsavedPreferences:()=>dirty,dispose:remove};
}

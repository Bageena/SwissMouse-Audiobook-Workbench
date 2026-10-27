import { createPortal } from 'react-dom';
import { useDialogFocus } from '../utils/useDialogFocus';
import React, { useEffect, useState } from 'react';
import { DesktopWindow } from './DesktopWorkspace';
import { PreviewPanel } from './PreviewPanel';
import { Check, Circle, AlertTriangle, Play, CircleAlert, FileSymlink, Sparkles, CheckCheck, FolderOpen, Loader2, Wrench, X } from 'lucide-react';
import { AudiobookJob, FinalCheckItem, FinalCheckReport } from '../types';
import { useDependencyStatus } from '../dependency-status';
import { type LibraryTransferMode } from './MoveToLibrary';

export type FinishLocation = 'current' | 'inbox' | 'library';
type CheckState = { running?:boolean;message?:string;items?:FinalCheckItem[];report?:FinalCheckReport;outdated?:boolean };
const fixes = {
  metadata:{title:'Review saved Metadata, then Convert again to write matching file tags.',step:3},
  chapters:{title:'Review and save chapters, then Convert again.',step:2},
  processing:{title:'Review processing options or regenerate the optional artifact.',step:1},
  sidecar:{title:'Rebuild missing or outdated metadata sidecars from saved Metadata.'},
  cover:{title:'Save the selected cover image beside the audiobook.'},
};
export const Step5Validate: React.FC<{job:AudiobookJob;onValidate:()=>Promise<void>;onCheckSourceAudio?:()=>Promise<string>;isValidating:boolean;onNavigate?:(step:number)=>void;onFinish?:(location:FinishLocation,target:string)=>Promise<string>;onMoveToLibrary?:(mode: LibraryTransferMode)=>Promise<string | undefined>}> = ({job,onValidate,isValidating,onNavigate,onFinish}) => {
  const availability=useDependencyStatus().feature('audio_processing');
  const [state,setState]=useState<CheckState>({report:job.finalCheck});
  const [error,setError]=useState('');
  const [starting,setStarting]=useState(false);
  const [repairing,setRepairing]=useState(false);
  const [opening,setOpening]=useState(false);
  const [finishLocation,setFinishLocation]=useState<FinishLocation|null>(null);
  const [finishing,setFinishing]=useState(false);
  const [finishMessage,setFinishMessage]=useState('');
  useEffect(()=>{
    let disposed=false;
    const refresh=async()=>{try{const response=await fetch(`/api/jobs/${job.id}/final-check`);if(response.ok){const data=await response.json();if(!disposed)setState(data);}}catch{/* Keep the previous report visible while reconnecting. */}};
    void refresh();const timer=setInterval(()=>void refresh(),isValidating?1000:5000);
    return ()=>{disposed=true;clearInterval(timer);};
  },[job.id,job.finalCheck,job.metadata,job.chapters,isValidating]);
  const busy=isValidating||starting||!!state.running;
  const report=state.report||job.finalCheck;
  const items=state.running?state.items||[]:report?.items||[];
  const run=async()=>{
    setError('');setStarting(true);
    try {await onValidate();const response=await fetch(`/api/jobs/${job.id}/final-check`);if(response.ok)setState(await response.json());}
    catch(err){setError(err instanceof Error?err.message:'Final Check failed.');}
    finally{setStarting(false);}
  };
  const cancel=async()=>{try{const response=await fetch(`/api/jobs/${job.id}/final-check/cancel`,{method:'POST'});if(!response.ok)throw new Error('Could not cancel the check.');}catch(err){setError(String(err));}};
  const repair=async(item:FinalCheckItem)=>{
    if(!item.fix)return;
    const action=fixes[item.fix];
    if('step' in action){onNavigate?.(action.step);return;}
    if(!job.outputM4b){onNavigate?.(4);return;}
    setRepairing(true);setError('');
    try{const response=await fetch(`/api/jobs/${job.id}/final-check/repair`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:item.fix})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Repair failed.');setState(current=>({...current,outdated:true}));}
    catch(err){setError(err instanceof Error?err.message:'Repair failed.');}
    finally{setRepairing(false);}
  };
  const openFolder=async()=>{setOpening(true);setError('');try{const response=await fetch(`/api/jobs/${job.id}/export/open-folder`,{method:'POST'});if(!response.ok){const data=await response.json();throw new Error(data.error||'Could not open folder.');}}catch(err){setError(String(err));}finally{setOpening(false);}};
  const workflowItems = summarize(items);
  const current = !state.outdated && report?.state === 'complete';
  const failures = items.some(item=>item.status==='failed');
  const optional = items.some(item=>item.status==='optional');
  const buttonState = busy || !current || failures || error ? 'required' : optional ? 'optional' : 'ready';
  const canFinish = current && !failures && !busy && !repairing && !finishing;
  const finish = async(target:string)=>{
    if(!finishLocation||!onFinish)return;
    setFinishing(true);setError('');
    try {setFinishMessage(await onFinish(finishLocation,target));setFinishLocation(null);}
    catch(err){setError(err instanceof Error?err.message:'Could not finish.');}
    finally{setFinishing(false);}
  };
  const status=busy?'Checking…':state.outdated?'Check outdated':report?.state==='cancelled'?'Check cancelled':report?items.some(item=>item.status==='failed')?'Needs attention':'Check complete':'Not checked yet';
  return <>
    <PreviewPanel id="final-check-workflow" title="Workflow">
      <div className="space-y-2 text-xs">
        <p role="status" className="font-semibold">{status}</p>
        {busy&&<p>{state.message||'Starting final check…'}</p>}
        {!items.length&&<p>Run Final Check to verify this book.</p>}
        <ul aria-label="Final check checklist" className="space-y-2">{workflowItems.map(item=><li key={item.id} className="flex items-start gap-1.5">
          <span title={busy||state.outdated||report?.state==='cancelled'?'Not current':item.status==='passed'?'Verified':item.status==='optional'?'Optional / not required':'Needs attention'} className={busy||state.outdated||report?.state==='cancelled'?'text-stone-500':item.status==='passed'?'text-emerald-700':item.status==='optional'?'text-amber-700':'text-red-700'}>
            {busy||state.outdated||report?.state==='cancelled'?<Circle className="h-3.5 w-3.5"/>:item.status==='passed'?<Check className="h-3.5 w-3.5"/>:<AlertTriangle className="h-3.5 w-3.5"/>}
          </span><span className="min-w-0 flex-1" title={item.detail}>{item.label}</span>
          {item.fix&&<button type="button" className="inline-flex shrink-0 items-center text-stone-700" aria-label={`Fix ${item.label}`} title={!job.outputM4b&&['sidecar','cover'].includes(item.fix)?'Convert into a dedicated book folder first.':fixes[item.fix].title} disabled={busy||repairing} onClick={()=>void repair(item)}><Wrench className="h-3 w-3" aria-hidden="true"/></button>}
        </li>)}</ul>
        {report&&<div className="border-t border-stone-300/60 pt-2 space-y-1">
          <p>Book length: {duration(report.expectedDuration)}</p>
          <p>{job.chapters.length} reviewed chapters</p>
          <p>{report.files.length} {job.outputM4b?'exported':'source'} file(s): {[...new Set(report.files.map(file=>file.format.toUpperCase()))].join(', ')||'None read'}</p>
          <p>{report.removedSeconds.toFixed(3)} seconds cut in Chapter Editor</p>
          <p>Checked: {new Date(report.checkedAt).toLocaleString()}</p>
        </div>}
      </div>
    </PreviewPanel>
    <DesktopWindow id="final-check" title="Final check"><section className="workspace-panel processing-panel processing-validation rounded-2xl border border-stone-200 bg-white shadow-sm">
      <header className="workspace-panel-header workspace-toolbar flex flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3">
        <h2 className="workspace-panel-title text-sm font-bold text-stone-900">Final Check</h2>
      </header>
      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-col items-center gap-3 py-4">
          <button type="button" className="final-check-run" data-state={buttonState} aria-label={job.outputM4b?'Check audiobook':'Check source audio'}
            title={availability.tooltip || (buttonState==='required'?'Run Final Check; required items need attention.':buttonState==='optional'?'Required checks passed; some optional features are absent.':'All checks passed. Run Final Check again.')}
            disabled={!availability.ready||busy||repairing||finishing} onClick={()=>void run()}>
            {busy?<Loader2 className="animate-spin" aria-hidden="true"/>:error||current&&failures?<CircleAlert aria-hidden="true"/>:current&&optional?<AlertTriangle aria-hidden="true"/>:current?<Check aria-hidden="true"/>:<Play aria-hidden="true"/>}
          </button>
          {busy&&<button type="button" className="processing-model-action-icon" aria-label="Cancel final check" title="Cancel final check" onClick={()=>void cancel()}><X aria-hidden="true"/></button>}
        </div>
        <p role="status" className="text-sm font-semibold">{status}{busy&&state.message?` · ${state.message}`:''}</p>
        {!job.outputM4b&&<p className="text-xs text-stone-600">Conversion was skipped. Source audio and companion files are checked here; chapter edits are written into audio files when you Convert.</p>}
        {state.outdated&&<p className="text-xs text-amber-800">Files, metadata, chapters, or settings changed. Run Final Check again.</p>}
        {error&&<p role="alert" className="text-sm text-red-800">{error}</p>}
        {!!report?.files.length&&<div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="text-left font-semibold mb-2">{job.outputM4b?'Exported media':'Source media'}</caption><thead><tr><th>Format</th><th>File</th><th>Length</th><th>Chapters</th></tr></thead><tbody>{report.files.map(file=><tr key={file.file}><td>{file.format.toUpperCase()}</td><td className="break-all" title={file.file}>{file.file.split(/[\\/]/).pop()}</td><td>{file.error?'Unreadable':duration(file.duration)}</td><td>{file.error?'—':file.chapters}</td></tr>)}</tbody></table></div>}
        {!!items.length&&<details><summary className="cursor-pointer text-sm font-semibold">Check details ({items.length})</summary><ul className="mt-3 space-y-3 text-xs">{items.map(item=><li key={item.id}><strong>{item.status==='passed'?'✓':item.status==='optional'?'—':'!'} {item.label}</strong><p className="whitespace-pre-wrap break-words">{item.detail}</p></li>)}</ul><p className="mt-3 text-xs text-stone-500">Audio coverage checks compare timelines and packet continuity. They do not prove every sound is identical or test navigation in your audiobook player.</p></details>}
        {job.outputM4b&&report&&<button type="button" className="inline-flex items-center gap-2 text-xs" disabled={opening||busy} onClick={()=>void openFolder()}><FolderOpen className="h-4 w-4"/>{opening?'Opening…':'Open containing folder'}</button>}
        {finishMessage&&<p role="status" className="text-xs text-emerald-800">{finishMessage}</p>}
        {onFinish&&<div className="flex justify-end"><div role="toolbar" aria-label="Finish processing" className="flex items-center gap-2">
          <button type="button" className="processing-model-action-icon" aria-label="Move to Library" title={canFinish?'Move to Library: verify copied audio, sidecars and cover before deleting originals.':'Run a current Final Check and fix required items first.'} disabled={!canFinish} onClick={()=>setFinishLocation('library')}><FileSymlink aria-hidden="true"/></button>
          <button type="button" className="processing-model-action-icon" aria-label="Clean up folder location and keep in Inbox" title="Organize within Inbox and remove disposable PCM. Keep waveform and transcript." disabled={!canFinish} onClick={()=>setFinishLocation('inbox')}><Sparkles aria-hidden="true"/></button>
          <button type="button" className="processing-model-action-icon" aria-label="Finish and keep current location" title="Finish here and remove disposable PCM. Keep waveform and transcript." disabled={!canFinish} onClick={()=>setFinishLocation('current')}><CheckCheck aria-hidden="true"/></button>
        </div></div>}
        {finishLocation&&<FinishDialog jobId={job.id} location={finishLocation} busy={finishing} error={error} onCancel={()=>{if(!finishing)setFinishLocation(null);}} onFinish={target=>void finish(target)}/>}
      </div>
    </section></DesktopWindow>
  </>;
};
function duration(seconds:number){const total=Math.max(0,Math.round(seconds));return `${Math.floor(total/3600)}h ${Math.floor(total%3600/60)}m ${total%60}s`;}

function summarize(items:FinalCheckItem[]):FinalCheckItem[]{
  const groups=new Map<string,FinalCheckItem[]>();
  for(const item of items){
    const suffix=item.id.match(/^file-\d+-(.+)$/)?.[1];
    const key=suffix|| (item.id.startsWith('sidecar-')?item.label:item.id.startsWith('cover-')?'cover':item.id);
    groups.set(key,[...(groups.get(key)||[]),item]);
  }
  const labels:Record<string,string>={decode:'Audio integrity',metadata:'File metadata',chapters:'Embedded chapters',coverage:'Audio coverage',art:'Embedded artwork',unsupported:'Format limitations',cover:'Cover beside audio'};
  return [...groups].map(([key,values])=>{
    const worst=values.find(item=>item.status==='failed')||values.find(item=>item.status==='passed')||values[0];
    return {...worst,id:key,label:labels[key]||worst.label,detail:values.map(item=>`${item.label}: ${item.detail}`).join('\n')};
  });
}

function FinishDialog({jobId,location,busy,error,onCancel,onFinish}:{jobId:string;location:FinishLocation;busy:boolean;error:string;onCancel:()=>void;onFinish:(target:string)=>void}){
  const [plan,setPlan]=useState<{target:string;files:string[];conflict:boolean}>();
  const [failure,setFailure]=useState('');
  const ref=useDialogFocus(()=>{if(!busy)onCancel();});
  useEffect(()=>{const controller=new AbortController();void fetch(`/api/jobs/${jobId}/finish?location=${location}`,{signal:controller.signal}).then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.error);setPlan(result);}).catch(err=>{if(!controller.signal.aborted)setFailure(err.message);});return()=>controller.abort();},[jobId,location]);
  const title=location==='library'?'Move to Library':location==='inbox'?'Clean up and keep in Inbox':'Finish in current location';
  return createPortal(<div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/40 p-4"><div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-lg rounded-xl border border-stone-300 bg-white p-5 text-stone-900 shadow-xl">
    <h3 className="text-base font-bold">{title}</h3>
    <p className="mt-3 text-sm">{location==='current'?'Your audio files stay where they are.':'Audio, associated sidecars and cover are copied and verified before original files are removed. Unrelated and shared files are kept.'} Disposable processing PCM is removed; waveform and transcript are retained.</p>
    {plan?<><p className="mt-3 break-all text-xs">{location==='current'?'Current folder':'Destination'}: {plan.target}</p><details className="mt-2 text-xs"><summary>Associated files ({plan.files.length})</summary><ul className="max-h-40 overflow-auto">{plan.files.map(file=><li key={file} className="break-all">{file}</li>)}</ul></details>{plan.conflict&&<p role="alert" className="mt-2 text-sm text-red-800">Destination exists. Existing files will not be overwritten.</p>}</>:!failure&&<p role="status">Checking files…</p>}
    {(failure||error)&&<p role="alert" className="mt-3 text-sm text-red-800">{failure||error}</p>}
    <div className="mt-4 flex justify-end gap-2"><button type="button" disabled={busy} onClick={onCancel} className="rounded-lg border px-3 py-2 text-sm">Cancel</button><button type="button" disabled={busy||!plan||plan.conflict||!!failure} onClick={()=>plan&&onFinish(plan.target)} className="paper-action-dark rounded-lg border px-3 py-2 text-sm font-semibold">{busy?'Finishing…':title}</button></div>
  </div></div>,document.body);
}

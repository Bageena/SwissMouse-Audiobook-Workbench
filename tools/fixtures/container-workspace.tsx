import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DesktopWorkspace, DesktopWindow, useDesktopWorkspace } from '../../src/components/DesktopWorkspace';
import { AdaptiveButton } from '../../src/components/AdaptiveButton';
import { Undo2, Redo2 } from 'lucide-react';
import { resetPageLayout } from '../../src/utils/desktopLayout';
import { applyTheme } from '../../src/theme';
import '../../src/index.css';

function Draft() {
  const audio = useRef<HTMLAudioElement>(null);
  const [audioSource] = useState(() => {
    const samples = 8000 * 30, data = new ArrayBuffer(44 + samples * 2), view = new DataView(data);
    const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, samples * 2, true);
    return URL.createObjectURL(new Blob([data], { type: 'audio/wav' }));
  });
  useEffect(() => () => URL.revokeObjectURL(audioSource), [audioSource]);
  const [text, setText] = useState('Draft survives layout changes');
  const [count, setCount] = useState(0);
  const renders = useRef(0); renders.current++;
  return <section style={{ padding: 16 }}><header className="workspace-panel-header"><h2 className="workspace-panel-title">Notes</h2></header>
    <label>Unsaved note<input aria-label="Unsaved note" value={text} onChange={e => setText(e.target.value)} /></label>
    <button type="button" onClick={() => setCount(value => value + 1)}>Local counter {count}</button>
    <audio ref={audio} aria-label="Panel continuity audio" src={audioSource} loop preload="auto" />
    <button type="button" onClick={() => void audio.current?.play()}>Play silent test audio</button>
    <button type="button" onClick={() => audio.current?.pause()}>Pause test audio</button>
    <p data-testid="draft-renders">Content renders: {renders.current}</p>
    <p>This form is a mounted widget. Moving and nesting must preserve its draft.</p></section>;
}
function Fixture() {
  const [page, setPage] = useState('container-fixture');
  return <div style={{ padding: 24 }}><h1>Container interaction check</h1>
    <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
      <button onClick={() => resetPageLayout(page)}>Reset fixture layout</button>
      <button onClick={() => setPage(p => p === 'container-fixture' ? 'container-second-page' : 'container-fixture')}>Switch fixture page</button>
      <select aria-label="Fixture theme" onChange={e => applyTheme(e.target.value as any)} defaultValue="light">{['light','forest','dark','cheese'].map(t => <option key={t}>{t}</option>)}</select>
    </div>
    <DesktopWorkspace page={page}>
      <HistoryControls />
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
        <DesktopWindow id="workbench" title="Workbench" kind="group"><section style={{ padding: 16, border: '1px solid var(--sm-border)', background: 'var(--sm-surface)' }}>
          <header className="workspace-panel-header"><h2 className="workspace-panel-title">Workbench</h2></header>
          <p>Arrange the content and the Notes widget inside this group.</p>
          <DesktopWindow id="notes" title="Notes" homeWindow="workbench"><Draft /></DesktopWindow>
        </section></DesktopWindow>
        <DesktopWindow id="tools" title="Tools" kind="bar" contentKind="menu" minimumWidth={210}><section style={{ padding: 16, minHeight: 220, background: 'var(--sm-surface)' }}>
          <p>A second container for magnet and connection checks. Its heading is supplied by the shared shell.</p>
        </section></DesktopWindow>
        <DesktopWindow id="second-notes" title="Second notes" role="child"><section style={{ padding: 16, minHeight: 180 }}><label>Second draft<input aria-label="Second draft" defaultValue="Also preserved" /></label><p>Independent child used to test automatic parent creation.</p></section></DesktopWindow>
      </div>
    </DesktopWorkspace>
  </div>;
}
function HistoryControls() {
  const workspace = useDesktopWorkspace();
  if (!workspace) return <p>Workspace updating…</p>;
  return <div className="adaptive-actions" style={{ maxWidth: 480, marginBottom: 20 }}>
    <AdaptiveButton icon={<Undo2 />} label="Undo workspace layout" description="Reverse the latest completed layout change" disabled={!workspace.canUndo} onClick={workspace.undo} />
    <AdaptiveButton icon={<Redo2 />} label="Redo workspace layout" disabled={!workspace.canRedo} onClick={workspace.redo} />
    <output aria-label="Workspace selection">{workspace.foreground || 'No selection'}</output>
    <output aria-label="Workspace ID">{workspace.page}</output>
  </div>;
}
const mount = document.getElementById('root')! as HTMLElement & { fixtureRoot?: ReturnType<typeof createRoot> };
(mount.fixtureRoot ||= createRoot(mount)).render(<Fixture />);

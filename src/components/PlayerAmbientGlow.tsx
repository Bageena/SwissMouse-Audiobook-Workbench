import { useEffect, useRef } from 'react';
import { quickPlayback } from '../playback/QuickPlaybackController';
import { nextAmbientLightLevel } from '../playback/ambientLightLevel';

/** Decorative light only: fixed geometry, no layout or player transforms. */
export function PlayerAmbientGlow({ enabled }: { enabled: boolean }) {
  const light = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = light.current;
    if (!enabled || !element) return;
    const player = quickPlayback();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let audio: HTMLMediaElement | undefined;
    let disposeTap = () => {};
    const stop = () => { disposeTap(); disposeTap = () => {}; audio = undefined; };
    const sync = () => {
      const state = player.getSnapshot();
      const playing = state.status === 'playing';
      element.dataset.playing = String(playing);
      const candidate = player.getAudioElement();
      if (!playing || state.muted || state.volume === 0 || document.hidden || reduced.matches) {
        stop(); element.style.removeProperty('--player-light-level'); return;
      }
      if (candidate === audio) return;
      stop();
      if (!(candidate instanceof HTMLMediaElement)) return;
      audio = candidate;
      const capture = (candidate as HTMLMediaElement & { captureStream?: () => MediaStream }).captureStream;
      if (!capture || typeof AudioContext === 'undefined') return;
      let context: AudioContext | undefined;
      let stream: MediaStream | undefined;
      let timer: ReturnType<typeof setInterval> | undefined;
      const clean = () => {
        if (timer !== undefined) clearInterval(timer);
        stream?.getTracks().forEach(track => track.stop());
        if (context && context.state !== 'closed') void context.close().catch(() => {});
        element.style.removeProperty('--player-light-level');
      };
      disposeTap = clean;
      try {
        // Observe a copy. Never connect to destination or alter the media source.
        stream = capture.call(candidate);
        if (!stream.getAudioTracks().length) { clean(); return; }
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        context.createMediaStreamSource(stream).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        let level = 0;
        void context.resume().catch(clean);
        timer = setInterval(() => {
          analyser.getByteTimeDomainData(samples);
          level = nextAmbientLightLevel(samples, level);
          element.style.setProperty('--player-light-level', String(.46 + level * .2));
        }, 100);
      } catch { clean(); }
    };
    const unsubscribe = player.subscribe(sync);
    document.addEventListener('visibilitychange', sync);
    reduced.addEventListener('change', sync);
    sync();
    return () => { unsubscribe(); stop(); document.removeEventListener('visibilitychange', sync); reduced.removeEventListener('change', sync); };
  }, [enabled]);
  return enabled ? <span ref={light} className="player-ambient-light" aria-hidden="true" /> : null;
}

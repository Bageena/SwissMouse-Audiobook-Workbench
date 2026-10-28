import { createBookmark, locatePosition, resolveBookmark } from './timeline';
import type { PlaybackBookmark, PlaybackManifest, ResolvedBookmark } from './types';

export interface QuickAudio {
  src: string;
  preload: string;
  volume: number;
  muted: boolean;
  currentTime: number;
  readyState: number;
  paused: boolean;
  ended: boolean;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}
export interface QuickPlaybackState {
  volume: number;
  muted: boolean;
  chapters?: PlaybackManifest['chapters'];
  queue?: { id: string; title: string; durationSeconds: number }[];
  preview?: { file: string; directory: string; url: string };
  jobId?: string;
  status: 'idle' | 'loading' | 'ready' | 'starting' | 'playing' | 'error';
  positionSeconds: number;
  totalDurationSeconds: number;
  segmentIndex: number;
  completed: boolean;
  error?: string;
  notice?: string;
  saveError?: string;
}
export const emptyQuickPlayback: QuickPlaybackState = { volume: 1, muted: false, status: 'idle', positionSeconds: 0, totalDurationSeconds: 0, segmentIndex: 0, completed: false };
export interface ListeningCheckpoint {
  mediaSignature: string;
  segmentId: string;
  segmentOffsetSeconds: number;
  positionSeconds: number;
  completed: boolean;
  clientSessionId: string;
  clientSequence: number;
}
type SavedCheckpoint = { jobId: string; payload: ListeningCheckpoint };
export interface QuickPlaybackDependencies {
  createAudio: () => QuickAudio;
  request: (url: string, options?: RequestInit) => Promise<Pick<Response, 'ok' | 'json'>>;
  setInterval: (callback: () => void, milliseconds: number) => unknown;
  clearInterval: (handle: unknown) => void;
  pauseOtherAudio?: (audio: QuickAudio) => void;
  activityTarget?: EventTarget;
  pageTarget?: EventTarget;
  sessionId?: string;
}

/** One streaming player and save queue, independent of where its controls render. */
export class QuickPlaybackController {
  private state: QuickPlaybackState = emptyQuickPlayback;
  private listeners = new Set<() => void>();
  private manifest?: PlaybackManifest;
  private audio?: QuickAudio;
  private positionReady = false;
  private audioListeners: [string, EventListener][] = [];
  private manifestRequest?: AbortController;
  private generation = 0;
  private mediaRevision = 0;
  private timer?: unknown;
  private sessionStarted = false;
  private resumeAfterLoadFailure?: PlaybackBookmark;
  private sequence = 0;
  private readonly sessionId: string;
  private pending = new Map<string, SavedCheckpoint>();
  private latest = new Map<string, SavedCheckpoint>();
  private failed = new Map<string, SavedCheckpoint>();
  private flushing?: Promise<void>;
  private onOtherPlay = (event: Event) => {
    const target = event.target as unknown as { tagName?: string };
    if (target !== this.audio && target?.tagName?.toLowerCase() === 'audio' && ['starting', 'playing'].includes(this.state.status)) void this.stop();
  };
  private onPageHide = () => {
    this.readPosition();
    const checkpoint = this.snapshot();
    if (!checkpoint) return;
    // Send the newest position immediately on unload. The endpoint rejects
    // older same-session sequence numbers, even if an earlier request arrives later.
    this.latest.set(checkpoint.jobId, checkpoint);
    this.pending.delete(checkpoint.jobId);
    void this.sendCheckpoint(checkpoint);
  };

  constructor(private readonly dependencies: QuickPlaybackDependencies) {
    this.sessionId = dependencies.sessionId || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    dependencies.activityTarget?.addEventListener('play', this.onOtherPlay, true);
    dependencies.pageTarget?.addEventListener('pagehide', this.onPageHide);
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(values: Partial<QuickPlaybackState>) {
    this.state = { ...this.state, ...values };
    for (const listener of this.listeners) listener();
  }
  setVolume = (value: number) => {
    if (!Number.isFinite(value)) return;
    const volume = Math.max(0, Math.min(1, value));
    if (this.audio) { this.audio.volume = volume; this.audio.muted = false; }
    this.update({ volume, muted: false });
  };
  toggleMute = () => {
    const muted = !this.state.muted;
    if (this.audio) this.audio.muted = muted;
    this.update({ muted });
  };
  private reportSaveState() {
    const saveError = this.failed.size ? 'Listening progress could not be saved. Retry to keep your latest position.' : undefined;
    if (this.state.saveError !== saveError) this.update({ saveError });
  }
  private clearTimer() {
    if (this.timer !== undefined) this.dependencies.clearInterval(this.timer);
    this.timer = undefined;
  }
  private clearAudio() {
    const audio = this.audio;
    if (!audio) return;
    this.audio = undefined;
    this.positionReady = false;
    for (const [type, handler] of this.audioListeners) audio.removeEventListener(type, handler);
    this.audioListeners = [];
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  private readPosition() {
    const segment = this.manifest?.segments[this.state.segmentIndex];
    if (!this.audio || !this.positionReady || !segment || !Number.isFinite(this.audio.currentTime)) return;
    const positionSeconds = segment.startSeconds + Math.max(0, Math.min(segment.durationSeconds, this.audio.currentTime));
    if (positionSeconds !== this.state.positionSeconds) this.update({ positionSeconds });
  }
  private snapshot(): SavedCheckpoint | undefined {
    if (this.state.preview) return;
    if (!this.manifest || !this.sessionStarted) return;
    const position = locatePosition(this.manifest, this.state.completed ? this.manifest.totalDurationSeconds : this.state.positionSeconds);
    const segment = this.manifest.segments[position.segmentIndex];
    return { jobId: this.manifest.bookId, payload: {
      mediaSignature: this.manifest.signature, segmentId: segment.id, segmentOffsetSeconds: position.offsetSeconds,
      positionSeconds: position.positionSeconds, completed: this.state.completed,
      clientSessionId: this.sessionId, clientSequence: ++this.sequence,
    } };
  }
  private async sendCheckpoint(checkpoint: SavedCheckpoint) {
    try {
      const response = await this.dependencies.request(`/api/jobs/${encodeURIComponent(checkpoint.jobId)}/listening`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(checkpoint.payload), keepalive: true,
        signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(15000) : undefined,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save listening progress.');
      if ((this.failed.get(checkpoint.jobId)?.payload.clientSequence || 0) <= checkpoint.payload.clientSequence) this.failed.delete(checkpoint.jobId);
    } catch {
      // An older failed request must never replace a newer pending checkpoint.
      if (this.latest.get(checkpoint.jobId)?.payload.clientSequence === checkpoint.payload.clientSequence) this.failed.set(checkpoint.jobId, checkpoint);
    }
    this.reportSaveState();
  }
  private flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const work = async () => {
      while (this.pending.size) {
        const [jobId, checkpoint] = this.pending.entries().next().value as [string, SavedCheckpoint];
        this.pending.delete(jobId);
        await this.sendCheckpoint(checkpoint);
      }
    };
    this.flushing = work().finally(() => { this.flushing = undefined; });
    return this.flushing;
  }
  checkpoint = (): Promise<void> => {
    this.readPosition();
    const checkpoint = this.snapshot();
    if (checkpoint) {
      this.latest.set(checkpoint.jobId, checkpoint);
      this.pending.set(checkpoint.jobId, checkpoint);
    }
    return this.flush();
  };
  retrySave = async (): Promise<void> => {
    // A server restart can expire its stream authorization cache. Re-register
    // unchanged audio before retrying, without replacing the visible position.
    for (const [id, checkpoint] of this.failed) {
      try {
        const response = await this.dependencies.request(`/api/jobs/${encodeURIComponent(id)}/playback`);
        const data = await response.json();
        if (response.ok && data.manifest?.signature === checkpoint.payload.mediaSignature) this.pending.set(id, this.latest.get(id) || checkpoint);
        else if (response.ok && id === this.state.jobId) this.update({ notice: 'The book’s audio changed. Press Play to check where your listening position can resume.' });
      } catch { /* Keep the checkpoint available for another retry. */ }
    }
    await this.checkpoint();
  };

  selectBook = async (jobId: string, localBookmark?: PlaybackBookmark): Promise<void> => {
    // A same-book revalidation must not collapse the player's timeline/playlist
    // while its fresh manifest is in flight. Switching books still clears them.
    const retainedDisplay = this.state.jobId === jobId && !this.state.preview ? {
      chapters: this.state.chapters, queue: this.state.queue,
      totalDurationSeconds: this.state.totalDurationSeconds,
      positionSeconds: this.state.positionSeconds,
    } : {};
    // Stop and snapshot synchronously; a slow save cannot keep the old audio alive.
    void this.stop();
    const generation = ++this.generation;
    this.manifestRequest?.abort();
    this.manifestRequest = new AbortController();
    const signal = this.manifestRequest.signal;
    if (localBookmark) this.resumeAfterLoadFailure = localBookmark;
    else if (this.resumeAfterLoadFailure?.bookId !== jobId) this.resumeAfterLoadFailure = undefined;
    this.manifest = undefined;
    this.sessionStarted = false;
    this.update({ ...emptyQuickPlayback, volume: this.state.volume, muted: this.state.muted, chapters: undefined, queue: undefined, ...retainedDisplay, preview: undefined, jobId, status: 'loading', error: undefined, notice: undefined });
    try {
      const response = await this.dependencies.request(`/api/jobs/${encodeURIComponent(jobId)}/playback`, { signal });
      const data = await response.json() as { manifest: PlaybackManifest; resume: ResolvedBookmark; error?: string };
      if (generation !== this.generation || signal.aborted) return;
      if (!response.ok) throw new Error(data.error || 'Audio is unavailable for this book.');
      const manifest = data.manifest;
      if (manifest?.bookId !== jobId || !manifest.segments?.length || !Number.isFinite(manifest.totalDurationSeconds) || !(manifest.totalDurationSeconds > 0) ||
          manifest.segments.some(segment => !segment.url || !Number.isFinite(segment.startSeconds) || segment.startSeconds < 0 || !Number.isFinite(segment.durationSeconds) || segment.durationSeconds <= 0)) throw new Error('This book does not have a playable audio timeline.');
      this.manifest = manifest;
      const retained = localBookmark || this.resumeAfterLoadFailure;
      const saved = retained ? resolveBookmark(manifest, retained) : data.resume;
      this.resumeAfterLoadFailure = undefined;
      const resume = locatePosition(manifest, saved?.completed ? manifest.totalDurationSeconds : saved?.positionSeconds || 0);
      this.update({ status: 'ready', chapters: manifest.chapters, queue: manifest.segments.map(({ id, title, durationSeconds }) => ({ id, title, durationSeconds })), totalDurationSeconds: manifest.totalDurationSeconds, positionSeconds: resume.positionSeconds,
        segmentIndex: resume.segmentIndex, completed: !!saved?.completed, notice: saved?.notice });
    } catch (error) {
      if (generation === this.generation && !signal.aborted) this.update({ status: 'error', error: error instanceof Error ? error.message : 'Audio could not be loaded.' });
    }
  };

  private async startSegment(index: number, offset: number) {
    this.clearAudio();
    const manifest = this.manifest;
    if (!manifest) return;
    const revision = ++this.mediaRevision;
    const audio = this.dependencies.createAudio();
    this.audio = audio;
    audio.volume = this.state.volume;
    audio.muted = this.state.muted;
    const segment = manifest.segments[index];
    this.update({ status: 'starting', segmentIndex: index, positionSeconds: segment.startSeconds + offset, completed: false, error: undefined });
    const active = () => this.audio === audio && revision === this.mediaRevision;
    let seekApplied = offset === 0;
    this.positionReady = seekApplied;
    const seek = () => {
      if (!active()) return;
      try { audio.currentTime = offset; seekApplied = true; this.positionReady = true; } catch { /* Retry when metadata is ready. */ }
    };
    const listen = (type: string, callback: () => void) => {
      const handler = (() => { if (active()) callback(); }) as EventListener;
      this.audioListeners.push([type, handler]); audio.addEventListener(type, handler);
    };
    listen('loadedmetadata', seek);
    listen('timeupdate', () => { if (seekApplied) this.readPosition(); });
    listen('pause', () => { if (!audio.paused || audio.ended || !['starting', 'playing'].includes(this.state.status)) return; void this.stop(); });
    listen('error', () => this.playbackFailed('This audio could not be played. It may be missing or use a format this browser cannot play.'));
    listen('ended', () => {
      this.update({ positionSeconds: segment.startSeconds + segment.durationSeconds });
      if (index + 1 < manifest.segments.length) {
        void this.checkpoint();
        void this.startSegment(index + 1, 0);
      } else {
        this.update({ positionSeconds: manifest.totalDurationSeconds, completed: true, status: 'ready' });
        this.clearAudio(); this.clearTimer();
        void this.checkpoint();
      }
    });
    audio.preload = 'metadata';
    audio.src = segment.url;
    audio.load();
    if (audio.readyState >= 1) seek();
    this.dependencies.pauseOtherAudio?.(audio);
    try {
      await audio.play();
      if (!active()) { audio.pause(); return; }
      if (!seekApplied) seek();
      this.update({ status: 'playing' });
    } catch (error) {
      if (active()) this.playbackFailed(error instanceof Error && error.name === 'NotAllowedError' ? 'Your browser paused playback. Press Play to try again.' : 'Playback could not start. Press Play to retry.');
    }
  }
  private playbackFailed(message: string) {
    this.readPosition();
    this.mediaRevision++;
    this.clearAudio(); this.clearTimer();
    this.update({ status: 'error', error: message });
    void this.checkpoint();
  }
  play = async (jobId = this.state.jobId): Promise<void> => {
    if (!jobId) return;
    if (this.state.jobId === jobId && ['playing', 'starting', 'loading'].includes(this.state.status)) return;
    if (this.state.preview && this.manifest && this.state.jobId === jobId) {
      await this.startSegment(0, this.state.completed ? 0 : this.state.positionSeconds);
      return;
    }
    // Revalidate on every user Play: processing may have produced a finalized
    // file, and stream contexts can expire after a server restart. A fresh GET
    // must not replace newer local progress with a slower checkpoint response.
    const local = this.state.jobId === jobId && this.manifest && this.sessionStarted
      ? createBookmark(this.manifest, this.state.positionSeconds, this.state.completed) : undefined;
    const loading = this.selectBook(jobId, local);
    const generation = this.generation;
    await loading;
    if (generation !== this.generation || this.state.jobId !== jobId || !this.manifest || ['playing', 'starting'].includes(this.state.status)) return;
    const position = locatePosition(this.manifest, this.state.completed ? 0 : this.state.positionSeconds);
    this.sessionStarted = true;
    this.clearTimer();
    this.timer = this.dependencies.setInterval(() => { void this.checkpoint(); }, 15000);
    await this.startSegment(position.segmentIndex, position.offsetSeconds);
    if (this.failed.has(jobId) && this.state.jobId === jobId) void this.checkpoint();
  };
  previewFile = async (jobId: string, file: string, directory: string, durationSeconds: number): Promise<void> => {
    const url = `/api/jobs/${encodeURIComponent(jobId)}/audio-preview?${new URLSearchParams({ file, directory })}`;
    if (this.state.preview?.url === url) { await this.play(jobId); return; }
    if (!(durationSeconds > 0)) throw new Error('This file has no confirmed playable duration.');
    const stopping = this.stopForSwitch();
    const generation = this.generation;
    await stopping;
    if (generation !== this.generation || this.state.jobId && this.state.jobId !== jobId) return;
    this.generation++;
    this.sessionStarted = false;
    this.manifest = { bookId: jobId, kind: 'source', signature: url, totalDurationSeconds: durationSeconds,
      segments: [{ id: url, signature: url, title: file, url, durationSeconds, startSeconds: 0 }] };
    this.update({ ...emptyQuickPlayback, volume: this.state.volume, muted: this.state.muted, chapters: undefined, queue: undefined, jobId, preview: { file, directory, url }, totalDurationSeconds: durationSeconds, status: 'ready', error: undefined, notice: undefined });
    await this.startSegment(0, 0);
  };
  seekPreview = async (seconds: number): Promise<void> => {
    if (!this.state.preview || !this.manifest) return;
    const position = Math.max(0, Math.min(this.manifest.totalDurationSeconds, seconds));
    if (this.state.status === 'playing') await this.startSegment(0, position);
    else this.update({ positionSeconds: position, completed: false });
  };
  seek = async (seconds: number): Promise<void> => {
    if (!this.manifest || !Number.isFinite(seconds)) return;
    if (this.state.preview) { await this.seekPreview(seconds); return; }
    const playing = ['playing', 'starting'].includes(this.state.status);
    const position = locatePosition(this.manifest, seconds);
    this.sessionStarted = true;
    this.update({ positionSeconds: position.positionSeconds, segmentIndex: position.segmentIndex, completed: false });
    if (playing) await this.startSegment(position.segmentIndex, position.offsetSeconds);
    else { this.mediaRevision++; this.clearAudio(); }
    await this.checkpoint();
  };
  stopAndReset = async (): Promise<void> => {
    const jobId = this.state.jobId;
    const stopping = this.stop();
    const generation = this.generation;
    await stopping;
    if (this.generation === generation && this.state.jobId === jobId) await this.seek(0);
  };
  stop = (): Promise<void> => {
    this.generation++;
    this.manifestRequest?.abort();
    this.readPosition();
    this.mediaRevision++;
    this.clearAudio(); this.clearTimer();
    if (this.state.status !== 'error') this.update({ status: this.manifest ? 'ready' : 'idle' });
    return this.checkpoint();
  };
  stopForSwitch = async (): Promise<void> => {
    const jobId = this.state.jobId;
    await this.stop();
    if (jobId && this.failed.has(jobId)) throw new Error('The audiobook stopped, but its listening position could not be saved. Retry before switching books.');
  };
  releaseBook = (jobId: string): void => {
    if (this.state.jobId !== jobId) return;
    void this.stop();
    this.manifest = undefined;
    this.sessionStarted = false;
    this.resumeAfterLoadFailure = undefined;
    this.update({ ...emptyQuickPlayback, volume: this.state.volume, muted: this.state.muted, chapters: undefined, queue: undefined, preview: undefined, jobId: undefined, error: undefined, notice: undefined });
  };
  dispose = (): void => {
    this.releaseBook(this.state.jobId || '');
    this.dependencies.activityTarget?.removeEventListener('play', this.onOtherPlay, true);
    this.dependencies.pageTarget?.removeEventListener('pagehide', this.onPageHide);
    this.listeners.clear();
  };
}

let controller: QuickPlaybackController | undefined;
export function quickPlayback(): QuickPlaybackController {
  if (!controller) controller = new QuickPlaybackController({
    createAudio: () => new Audio(), request: (url, options) => fetch(url, options),
    setInterval: (callback, milliseconds) => window.setInterval(callback, milliseconds),
    clearInterval: handle => window.clearInterval(handle as number),
    activityTarget: typeof document === 'undefined' ? undefined : document,
    pageTarget: typeof window === 'undefined' ? undefined : window,
    pauseOtherAudio: quickAudio => document.querySelectorAll('audio').forEach(audio => { if (audio !== quickAudio && !audio.paused) audio.pause(); }),
  });
  return controller;
}
export const stopQuickPlayback = (): Promise<void> => controller?.stopForSwitch() || Promise.resolve();

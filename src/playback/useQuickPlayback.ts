import { useEffect, useSyncExternalStore } from 'react';
import { emptyQuickPlayback, quickPlayback } from './QuickPlaybackController';
export { stopQuickPlayback } from './QuickPlaybackController';

export function useQuickPlayback(jobId: string, playRequest = 0) {
  const player = quickPlayback();
  const state = useSyncExternalStore(player.subscribe, player.getSnapshot, () => emptyQuickPlayback);
  useEffect(() => {
    let active = true;
    void player.selectBook(jobId).then(() => { if (active && playRequest) void player.play(jobId); });
    return () => { active = false; player.releaseBook(jobId); };
  }, [player, jobId, playRequest]);
  return { state: state.jobId === jobId ? state : emptyQuickPlayback,
    setVolume: player.setVolume, toggleMute: player.toggleMute,
    play: () => player.play(jobId), pause: player.stop, stop: player.stopAndReset, seek: player.seek, retrySave: player.retrySave,
    seekPreview: player.seekPreview, endPreview: () => player.selectBook(jobId) };
}

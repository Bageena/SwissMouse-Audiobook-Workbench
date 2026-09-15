import React, { useState, useEffect } from 'react';
import {
  Video,
  Download,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Trash2,
  ExternalLink,
  ShieldCheck,
  Film,
  Music,
  Clock,
  HardDrive,
  Info,
  Terminal,
  Layers,
  ArrowRight
} from 'lucide-react';
import {
  YouTubeVideoInfo,
  YtDlpStatusInfo,
  YouTubeAudioFormat,
  AudiobookJob
} from '../types';

interface YouTubeAudioImportProps {
  job: AudiobookJob;
  onAudioImported: (updatedJob: AudiobookJob) => void;
  onCancel?: () => void;
}

export const YouTubeAudioImport: React.FC<YouTubeAudioImportProps> = ({
  job,
  onAudioImported,
  onCancel,
}) => {
  // Input URL
  const [url, setUrl] = useState<string>(job.youtubeUrl || '');
  const [isUrlValid, setIsUrlValid] = useState<boolean>(false);

  // yt-dlp Status State
  const [ytDlpStatus, setYtDlpStatus] = useState<YtDlpStatusInfo | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(true);
  const [isManagingTool, setIsManagingTool] = useState<boolean>(false);
  const [toolActionMessage, setToolActionMessage] = useState<string | null>(null);
  const [showUninstallConfirm, setShowUninstallConfirm] = useState<boolean>(false);

  // Video Inspection State
  const [isFetchingInfo, setIsFetchingInfo] = useState<boolean>(false);
  const [videoInfo, setVideoInfo] = useState<YouTubeVideoInfo | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Download Options State
  const [selectedFormat, setSelectedFormat] = useState<YouTubeAudioFormat>('best');
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState<boolean>(false);

  // Fetch yt-dlp status on mount
  const checkStatus = async () => {
    setIsLoadingStatus(true);
    try {
      const res = await fetch('/api/tools/yt-dlp/status');
      if (res.ok) {
        const data = await res.json();
        setYtDlpStatus(data);
      }
    } catch (e) {
      console.error('Failed to check yt-dlp status', e);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  useEffect(() => {
    checkStatus();
  }, []);

  // Validate URL format
  useEffect(() => {
    const trimmed = url.trim();
    const valid = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be)\/.+$/i.test(trimmed);
    setIsUrlValid(valid);
    if (!valid && videoInfo) {
      // Clear inspected info if URL was changed to something invalid
      setVideoInfo(null);
      setDownloadSuccess(null);
    }
  }, [url]);

  // Install yt-dlp
  const handleInstallYtDlp = async () => {
    setIsManagingTool(true);
    setToolActionMessage('Downloading and installing yt-dlp binary...');
    try {
      const res = await fetch('/api/tools/yt-dlp/install', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.info) {
        setYtDlpStatus(data.info);
        setToolActionMessage(data.message || 'yt-dlp installed successfully.');
      } else {
        setToolActionMessage(`Install failed: ${data.error || 'Unknown error'}`);
      }
    } catch (e: any) {
      setToolActionMessage(`Install error: ${e.message}`);
    } finally {
      setIsManagingTool(false);
      setTimeout(() => setToolActionMessage(null), 5000);
    }
  };

  // Update yt-dlp
  const handleUpdateYtDlp = async () => {
    setIsManagingTool(true);
    setToolActionMessage('Checking for yt-dlp updates...');
    try {
      const res = await fetch('/api/tools/yt-dlp/update', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.info) {
        setYtDlpStatus(data.info);
        setToolActionMessage(data.message || 'yt-dlp is now up to date.');
      } else {
        setToolActionMessage(`Update failed: ${data.error || 'Unknown error'}`);
      }
    } catch (e: any) {
      setToolActionMessage(`Update error: ${e.message}`);
    } finally {
      setIsManagingTool(false);
      setTimeout(() => setToolActionMessage(null), 5000);
    }
  };

  // Uninstall yt-dlp
  const handleUninstallYtDlp = async () => {
    setShowUninstallConfirm(false);
    setIsManagingTool(true);
    setToolActionMessage('Removing local yt-dlp executable...');
    try {
      const res = await fetch('/api/tools/yt-dlp/uninstall', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.info) {
        setYtDlpStatus(data.info);
        setVideoInfo(null);
        setToolActionMessage(data.message || 'Local yt-dlp uninstalled.');
      } else {
        setToolActionMessage(`Uninstall failed: ${data.error || 'Unknown error'}`);
      }
    } catch (e: any) {
      setToolActionMessage(`Uninstall error: ${e.message}`);
    } finally {
      setIsManagingTool(false);
      setTimeout(() => setToolActionMessage(null), 5000);
    }
  };

  // Fetch Video Information
  const handleFetchVideoInfo = async () => {
    if (!isUrlValid) return;
    setIsFetchingInfo(true);
    setFetchError(null);
    setDownloadError(null);
    setDownloadSuccess(null);

    try {
      const res = await fetch('/api/youtube/fetch-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setFetchError(data.message || data.error || 'Failed to inspect YouTube video.');
        setVideoInfo(null);
      } else {
        setVideoInfo(data.info);
      }
    } catch (err: any) {
      setFetchError(err.message || 'Network error while inspecting video.');
      setVideoInfo(null);
    } finally {
      setIsFetchingInfo(false);
    }
  };

  // Trigger Download
  const handleDownloadAudio = async (overwrite = false) => {
    if (!videoInfo || !isUrlValid) return;
    setIsDownloading(true);
    setDownloadProgress(20);
    setDownloadError(null);
    setDownloadSuccess(null);
    setShowOverwriteConfirm(false);

    // Simulate progress animation while server downloads
    const progressInterval = setInterval(() => {
      setDownloadProgress(prev => (prev < 90 ? prev + 15 : prev));
    }, 800);

    try {
      const res = await fetch('/api/youtube/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job.id,
          url: url.trim(),
          format: selectedFormat,
          overwrite,
        }),
      });

      clearInterval(progressInterval);
      setDownloadProgress(100);

      const data = await res.json();
      if (!res.ok) {
        setDownloadError(data.message || data.error || 'Failed to download audio.');
      } else {
        setDownloadSuccess(`Downloaded successfully: ${data.file.fileName}`);
        if (data.job) {
          onAudioImported(data.job);
        }
      }
    } catch (err: any) {
      clearInterval(progressInterval);
      setDownloadError(err.message || 'Network error while downloading audio.');
    } finally {
      setIsDownloading(false);
    }
  };

  const isToolInstalled = ytDlpStatus?.status === 'installed';
  const isFfmpegReady = ytDlpStatus?.ffmpegAvailable;

  return (
    <div id="youtube-audio-import-container" className="space-y-6">
      {/* 1. Mandatory Legal & Rights Responsibility Notice */}
      <div
        id="youtube-legal-notice"
        className="bg-stone-900/90 border border-amber-500/30 rounded-xl p-4.5 text-stone-300 text-xs leading-relaxed flex items-start gap-3 shadow-md"
      >
        <div className="w-5 h-5 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center flex-shrink-0 text-amber-400 mt-0.5">
          <ShieldCheck className="w-3.5 h-3.5" />
        </div>
        <div>
          <span className="font-semibold text-amber-300 block mb-0.5">
            Content Rights & Terms of Service Notice
          </span>
          <p className="text-stone-300">
            Download only content you own, have permission to download, or are otherwise authorized to use. You are responsible for complying with YouTube’s Terms of Service, copyright law, and all applicable rights restrictions.
          </p>
        </div>
      </div>

      {/* 2. Dependency Management Box */}
      <div
        id="ytdlp-management-panel"
        className="bg-stone-900 border border-stone-800 rounded-xl p-4.5 space-y-3"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-800 pb-3">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-stone-400" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-300">
              Local Tooling: yt-dlp & FFmpeg
            </h4>
          </div>

          <div className="flex items-center gap-2">
            {isLoadingStatus ? (
              <span className="text-xs text-stone-400 flex items-center gap-1.5">
                <RefreshCw className="w-3 h-3 animate-spin text-amber-400" />
                Checking status...
              </span>
            ) : isToolInstalled ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                yt-dlp {ytDlpStatus?.version || 'Ready'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-medium">
                <AlertTriangle className="w-3.5 h-3.5" />
                yt-dlp Not Installed
              </span>
            )}
          </div>
        </div>

        {/* Binary Details & Status Rows */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="bg-stone-950/60 border border-stone-800/80 rounded-lg p-3">
            <div className="text-stone-400 font-medium mb-1">yt-dlp Executable</div>
            {isToolInstalled ? (
              <div className="space-y-0.5">
                <div className="font-mono text-stone-200 truncate" title={ytDlpStatus?.executablePath}>
                  {ytDlpStatus?.executablePath}
                </div>
                <div className="text-[11px] text-stone-500">
                  Version: {ytDlpStatus?.version} • Local storage
                </div>
              </div>
            ) : (
              <div className="text-amber-400">
                yt-dlp is required for YouTube Audio Import. Install it to fetch video information and download audio.
              </div>
            )}
          </div>

          <div className="bg-stone-950/60 border border-stone-800/80 rounded-lg p-3">
            <div className="text-stone-400 font-medium mb-1">FFmpeg & FFprobe Media Engine</div>
            {isFfmpegReady ? (
              <div className="space-y-0.5">
                <div className="font-mono text-stone-200">
                  Installed ({ytDlpStatus?.ffmpegVersion || 'available'})
                </div>
                <div className="text-[11px] text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  Ready for audio extraction, PCM merge, and transcode
                </div>
              </div>
            ) : (
              <div className="text-amber-400 text-[11px]">
                FFmpeg is required to extract, merge, and convert audio. Install or configure FFmpeg before downloading converted audio formats.
              </div>
            )}
          </div>
        </div>

        {/* Tool Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {!isToolInstalled ? (
            <button
              id="install-ytdlp-btn"
              type="button"
              disabled={isManagingTool}
              onClick={handleInstallYtDlp}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-stone-950 font-semibold text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              {isManagingTool ? 'Installing...' : 'Install yt-dlp'}
            </button>
          ) : (
            <>
              <button
                id="update-ytdlp-btn"
                type="button"
                disabled={isManagingTool}
                onClick={handleUpdateYtDlp}
                className="px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700 text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isManagingTool ? 'animate-spin' : ''}`} />
                Update yt-dlp
              </button>

              <button
                id="uninstall-ytdlp-btn"
                type="button"
                disabled={isManagingTool}
                onClick={() => setShowUninstallConfirm(true)}
                className="px-3 py-1.5 rounded-lg bg-stone-800/80 hover:bg-red-950/40 text-stone-400 hover:text-red-300 border border-stone-800 hover:border-red-900/50 text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Uninstall yt-dlp
              </button>
            </>
          )}

          <button
            type="button"
            onClick={checkStatus}
            disabled={isLoadingStatus}
            className="px-2.5 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-400 hover:text-stone-200 border border-stone-800 text-xs flex items-center gap-1 transition-colors ml-auto"
            title="Refresh status"
          >
            <RefreshCw className={`w-3 h-3 ${isLoadingStatus ? 'animate-spin' : ''}`} />
            Check Status
          </button>
        </div>

        {/* Tool Action Message */}
        {toolActionMessage && (
          <div className="text-xs px-3 py-2 rounded-lg bg-stone-950 border border-stone-800 text-stone-300 flex items-center gap-2">
            <Info className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
            <span>{toolActionMessage}</span>
          </div>
        )}

        {/* Uninstall Confirmation Modal */}
        {showUninstallConfirm && (
          <div className="p-3 bg-red-950/40 border border-red-800/60 rounded-lg text-xs space-y-2">
            <div className="font-semibold text-red-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              Confirm yt-dlp Removal
            </div>
            <p className="text-stone-300">
              This will safely remove only the optional local executable in <code className="text-red-300 font-mono">runtime/bin/yt-dlp.exe</code>. Your downloaded audio files, Whisper models, and audiobook jobs will remain completely untouched.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleUninstallYtDlp}
                className="px-3 py-1 rounded bg-red-700 hover:bg-red-600 text-white font-medium"
              >
                Confirm Uninstall
              </button>
              <button
                type="button"
                onClick={() => setShowUninstallConfirm(false)}
                className="px-3 py-1 rounded bg-stone-800 hover:bg-stone-700 text-stone-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3. YouTube URL Input & Inspection Area */}
      <div className="bg-stone-900 border border-stone-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <label htmlFor="youtube-url-input" className="text-xs font-semibold uppercase tracking-wider text-stone-300 flex items-center gap-2">
            <Video className="w-4 h-4 text-red-500" />
            YouTube Video URL
          </label>
          <span className="text-[11px] text-stone-400">
            Accepts youtube.com/watch, youtu.be, and shorts links
          </span>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <input
              id="youtube-url-input"
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              disabled={!isToolInstalled || isFetchingInfo || isDownloading}
              className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3.5 py-2.5 text-stone-100 placeholder-stone-600 text-sm font-mono focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
            />
            {url && (
              <button
                type="button"
                onClick={() => setUrl('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300 p-1"
                title="Clear URL"
              >
                <XCircle className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            id="fetch-video-info-btn"
            type="button"
            disabled={!isToolInstalled || !isUrlValid || isFetchingInfo || isDownloading}
            onClick={handleFetchVideoInfo}
            className="px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-stone-950 font-semibold text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {isFetchingInfo ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Inspecting Video...
              </>
            ) : (
              <>
                <Film className="w-3.5 h-3.5" />
                Fetch Video Info
              </>
            )}
          </button>
        </div>

        {/* Validation or Inspection Error */}
        {fetchError && (
          <div className="p-3.5 rounded-lg bg-red-950/40 border border-red-800/60 text-xs text-red-200 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-semibold block">Inspection Error</span>
              <p>{fetchError}</p>
            </div>
          </div>
        )}

        {!isToolInstalled && (
          <div className="p-3 rounded-lg bg-stone-950 border border-amber-800/40 text-xs text-amber-300 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span>yt-dlp is required for YouTube Audio Import. Install it to fetch video information and download audio.</span>
            </div>
            <button
              type="button"
              onClick={handleInstallYtDlp}
              disabled={isManagingTool}
              className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold text-xs flex-shrink-0"
            >
              Install yt-dlp
            </button>
          </div>
        )}
      </div>

      {/* 4. Fetched Video Details & Audio Format Options (Appears after successful inspection) */}
      {videoInfo && (
        <div
          id="inspected-video-card"
          className="bg-stone-900 border border-amber-900/40 rounded-xl p-5 space-y-5 shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-stone-800 pb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-200">
                Video Details Verified
              </h4>
            </div>
            <span className="text-xs text-stone-400">
              Does not download until you click "Download Audio"
            </span>
          </div>

          <div className="flex flex-col md:flex-row gap-4 items-start">
            {/* Thumbnail Preview */}
            {videoInfo.thumbnailUrl ? (
              <img
                src={videoInfo.thumbnailUrl}
                alt={videoInfo.title}
                referrerPolicy="no-referrer"
                className="w-full md:w-48 h-28 object-cover rounded-lg border border-stone-800 shadow bg-stone-950 flex-shrink-0"
              />
            ) : (
              <div className="w-full md:w-48 h-28 rounded-lg bg-stone-950 border border-stone-800 flex items-center justify-center text-stone-600 flex-shrink-0">
                <Music className="w-8 h-8" />
              </div>
            )}

            {/* Metadata Information */}
            <div className="space-y-2 flex-1 min-w-0">
              <h3 className="text-base font-semibold text-stone-100 leading-snug">
                {videoInfo.title}
              </h3>
              <div className="flex flex-wrap items-center gap-3 text-xs text-stone-400">
                <span className="text-stone-300 font-medium">{videoInfo.uploader}</span>
                <span>•</span>
                <span className="flex items-center gap-1 font-mono text-amber-300">
                  <Clock className="w-3 h-3" />
                  {videoInfo.durationFormatted}
                </span>
                <span>•</span>
                <span className="text-stone-400">
                  Audio Quality: {videoInfo.audioBitrate || 'Best'}
                </span>
              </div>
              {videoInfo.description && (
                <p className="text-xs text-stone-400 line-clamp-2 leading-relaxed">
                  {videoInfo.description}
                </p>
              )}
            </div>
          </div>

          {/* Audio Output Format Selection */}
          <div className="border-t border-stone-800 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-stone-300">
                Audio Output Format
              </label>
              <span className="text-[11px] text-stone-400">
                Saved into: <code className="font-mono text-stone-300">output/imports/youtube/</code>
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              {[
                { id: 'best', label: 'Best Available', sub: 'Preserve source' },
                { id: 'm4a', label: 'M4A', sub: 'AAC audio' },
                { id: 'mp3', label: 'MP3', sub: 'FFmpeg transcode' },
                { id: 'flac', label: 'FLAC', sub: 'Lossless PCM' },
                { id: 'opus', label: 'Opus', sub: 'High efficiency' },
                { id: 'wav', label: 'WAV', sub: 'Uncompressed' },
              ].map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSelectedFormat(opt.id as YouTubeAudioFormat)}
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    selectedFormat === opt.id
                      ? 'bg-amber-500/15 border-amber-500/50 text-amber-200'
                      : 'bg-stone-950/60 border-stone-800 hover:border-stone-700 text-stone-300'
                  }`}
                >
                  <div className="font-semibold text-xs">{opt.label}</div>
                  <div className="text-[10px] text-stone-400 mt-0.5">{opt.sub}</div>
                </button>
              ))}
            </div>

            {selectedFormat === 'mp3' && (
              <p className="text-[11px] text-stone-400 flex items-center gap-1.5">
                <Info className="w-3 h-3 text-amber-400" />
                MP3 conversion re-encodes source audio to standard CBR MP3 via FFmpeg.
              </p>
            )}
          </div>

          {/* Download Action Section */}
          <div className="border-t border-stone-800 pt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="text-xs text-stone-400">
              Ready to extract audio from YouTube and import into current workbench session.
            </div>

            <button
              id="download-youtube-audio-btn"
              type="button"
              disabled={isDownloading || !isToolInstalled}
              onClick={() => handleDownloadAudio(false)}
              className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-stone-950 font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md hover:shadow-emerald-950/40 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDownloading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Downloading ({downloadProgress}%)...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Download Audio
                </>
              )}
            </button>
          </div>

          {/* Download Status & Errors */}
          {downloadError && (
            <div className="p-3.5 rounded-lg bg-red-950/40 border border-red-800/60 text-xs text-red-200 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="space-y-1 flex-1">
                <span className="font-semibold block">Download Failed</span>
                <p>{downloadError}</p>
              </div>
            </div>
          )}

          {downloadSuccess && (
            <div className="p-3.5 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-xs text-emerald-200 flex items-center justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span>{downloadSuccess}</span>
              </div>
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold text-[11px]">
                Imported to Project
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

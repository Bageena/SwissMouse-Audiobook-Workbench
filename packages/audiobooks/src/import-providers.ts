import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { formatTimestamp } from './ffmetadata';
import type { AudiobookFilePorts, FileCommandInput, UploadedAudio } from './file-ports';
import { fileReply as reply, type SourceFileFacts } from './file-ports';
import type { AudiobookJob, YouTubeAudioFormat, YouTubeVideoInfo } from './legacy-domain';
const execFileAsync = promisify(execFile);

export function createImportProviders(host: AudiobookFilePorts, source: Pick<SourceFileFacts, "probeAudioFile">) {
  const { probeAudioFile } = source;
  async function postYoutubeFetchInfo(input: FileCommandInput) {
    const { url } = input.body as {
      url?: string;
    };
    if (!url || typeof url !== 'string' || !url.trim()) {
      return reply(400, { error: 'Please enter a valid YouTube video URL.' });
    }
    let cleanUrl: string;
    try {
      cleanUrl = host.providers.youtubeUrl(url);
    }
    catch (error: any) {
      return reply(400, { error: error.message });
    }
    const status = await host.providers.status();
    if (status.status !== 'installed') {
      return reply(400, {
        error: 'yt-dlp Required',
        message: 'yt-dlp is required for YouTube Audio Import. Install it to fetch video information and download audio.',
      });
    }
    try {
      const { stdout } = await execFileAsync(status.executablePath, [...host.providers.youtubeArgs(), '--dump-single-json', '--skip-download', '--', cleanUrl], {
        encoding: 'utf8', timeout: 120000, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
      });
      const parsed = JSON.parse(stdout);
      const duration = parsed.duration ? Math.round(parsed.duration) : 0;
      const info: YouTubeVideoInfo = {
        url: cleanUrl,
        title: parsed.title || 'Untitled YouTube Audio',
        uploader: parsed.uploader || parsed.channel || 'Unknown Channel',
        uploaderUrl: parsed.uploader_url || parsed.channel_url,
        durationSeconds: duration,
        durationFormatted: formatTimestamp(duration),
        thumbnailUrl: parsed.thumbnail,
        description: parsed.description ? parsed.description.slice(0, 320) : undefined,
        audioBitrate: parsed.abr ? `${Math.round(parsed.abr)} kbps` : 'Best available',
        availableFormats: ['Best available / preserve source', 'M4A', 'MP3', 'FLAC', 'Opus', 'WAV'],
      };
      return reply(200, { status: 'ok', info });
    }
    catch (err: any) {
      const errorMsg = err.message || 'Failed to inspect YouTube video';
      let userMsg = 'Unable to fetch YouTube video details. Ensure the video is public and accessible.';
      if (errorMsg.includes('Private video')) {
        userMsg = 'This video is private. Please provide a link to a public or unlisted video.';
      }
      else if (errorMsg.includes('Video unavailable')) {
        userMsg = 'Video is unavailable or has been removed.';
      }
      else if (errorMsg.includes('timed out')) {
        userMsg = 'Request timed out while contacting YouTube. Please check your network connection and try again.';
      }
      return reply(400, { error: 'Inspection Failed', message: userMsg, details: errorMsg });
    }
  }

  async function postYoutubeDownload(input: FileCommandInput) {
    const { jobId, url, format = 'best', } = input.body as {
      jobId?: string;
      url?: string;
      format?: YouTubeAudioFormat;
      overwrite?: boolean;
    };
    let cleanUrl: string;
    try {
      cleanUrl = host.providers.youtubeUrl(url);
    }
    catch (error: any) {
      return reply(400, { error: error.message });
    }
    if (!['best', 'mp3', 'm4a', 'flac', 'opus', 'wav'].includes(format))
      return reply(400, { error: 'Unsupported audio format.' });
    const targetJob = jobId ? host.store.get(jobId) : undefined;
    if (jobId && !targetJob)
      return reply(404, { error: 'Job not found' });
    if (host.activity.imports.has(jobId || '') || host.work.processing || targetJob?.exports?.some(e => ['queued', 'running'].includes(e.status)))
      return reply(409, { error: 'Wait for the active import, processing or export to complete.' });
    const status = await host.providers.status();
    if (status.status !== 'installed') {
      return reply(400, {
        error: 'yt-dlp Required',
        message: 'yt-dlp is required for YouTube Audio Import. Install it to fetch video information and download audio.',
      });
    }
    if (format !== 'best' && !status.ffmpegAvailable) {
      return reply(400, {
        error: 'FFmpeg Required',
        message: 'FFmpeg is required to extract, merge, and convert audio. Install or configure FFmpeg before downloading converted audio formats.',
      });
    }
    if (!status.ffprobeAvailable)
      return reply(400, { error: 'FFprobe is required to verify downloaded audio. Install / Repair FFmpeg first.' });
    const importDir = host.locations.appPath('output', 'imports', 'youtube', randomUUID());
    // Dependency inspection above is asynchronous; recheck before taking the lock.
    if (host.activity.imports.has(jobId || '') || host.work.processing || targetJob?.exports?.some(e => ['queued', 'running'].includes(e.status)))
      return reply(409, { error: 'Wait for the active import, processing or export to complete.' });
    host.activity.imports.add(jobId || '');
    try {
      const latestFile = await host.providers.downloadYoutubeAudio(status.executablePath, path.dirname(host.media.ffmpeg()), importDir, cleanUrl, format);
      const probe = probeAudioFile(latestFile.fullPath);
      const fileStat = fs.statSync(latestFile.fullPath);
      // If active job provided, update job with this newly downloaded audio part
      let updatedJob: AudiobookJob | undefined;
      if (jobId) {
        const job = host.store.get(jobId);
        if (job) {
          const cleanTitle = path.basename(latestFile.file, path.extname(latestFile.file));
          const newPart = {
            id: `yt-part-${Date.now()}`,
            name: latestFile.file,
            sizeBytes: fileStat.size,
            durationSeconds: probe.durationSeconds,
            bitrate: probe.bitrate,
            order: 1,
          };
          job.inputMethod = 'youtube';
          job.mergeMethod = 'quick';
          job.status = 'draft';
          job.mergedMp3 = null;
          job.previewPath = undefined;
          job.sourceKey = undefined;
          job.preparedAudioKey = undefined;
          job.transcription = null;
          job.transcriptWords = [];
          job.transcriptKey = undefined;
          job.existingChapters = [];
          job.chapterReviewBaseline = undefined;
          job.chapters = [];
          job.candidates = [];
          job.outputM4b = null;
          job.validation = null;
          job.exports = [];
          job.hasNestedChapterFolders = false;
          job.youtubeUrl = cleanUrl;
          job.downloadedAudioFile = latestFile.fullPath;
          job.parts = [newPart];
          job.totalDurationSeconds = probe.durationSeconds;
          job.totalSizeBytes = fileStat.size;
          job.sourceFolderPath = importDir;
          // Set discovered files
          job.discoveredFiles = [{
            relativePath: latestFile.file,
            fileName: latestFile.file,
            folderName: 'YouTube Import',
            format: probe.format,
            codec: probe.codec,
            sampleRate: probe.sampleRate,
            channels: probe.channels,
            bitrate: probe.bitrate,
            sizeBytes: fileStat.size,
            durationSeconds: probe.durationSeconds,
            isProbed: true,
            streamSignature: probe.streamSignature,
          }];
          // Source summary
          job.sourceSummary = {
            inputMethod: 'youtube',
            sourcePath: latestFile.fullPath,
            formatsDetected: [probe.format],
            totalFiles: 1,
            totalDurationSeconds: probe.durationSeconds,
            chapterWorkflow: job.chapterSource || 'whisperx',
            mergeMethod: job.mergeMethod || 'quick',
          };
          job.logs.push({
            timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
            level: 'INFO',
            message: `YouTube Audio Import: Successfully downloaded and processed "${cleanTitle}" (${probe.format.toUpperCase()}, ${probe.bitrate} kbps, ${formatTimestamp(probe.durationSeconds)}) into output/imports/youtube/. Added as project source file.`,
          });
          updatedJob = job;
          host.store.commit();
        }
      }
      return reply(200, {
        status: 'ok',
        message: `Audio downloaded successfully: ${latestFile.file}`,
        file: {
          fileName: latestFile.file,
          filePath: latestFile.fullPath,
          format: probe.format,
          codec: probe.codec,
          bitrate: probe.bitrate,
          durationSeconds: probe.durationSeconds,
          sizeBytes: fileStat.size,
        },
        job: updatedJob,
      });
    }
    catch (err: any) {
      host.logs.failure(jobId, 'YouTube import', err.message || 'yt-dlp download failed.');
      return reply(500, {
        error: 'Download Failed',
        message: err.message || 'Failed to download audio with yt-dlp. Please check the URL and your local network.',
      });
    }
    finally {
      host.activity.imports.delete(jobId || '');
    }
  }

  async function postUploadAudio(input: FileCommandInput) {
    const received = input.files as {
      files?: UploadedAudio[];
      cover?: UploadedAudio[];
    } | undefined;
    if (!received?.files?.length) {
      for (const file of received?.cover || []) {
        try {
          fs.unlinkSync(file.path);
        }
        catch { }
      }
      host.logs.import(input.query.jobId as string | undefined, 'ERROR', 'No files were received.');
      return reply(400, { error: 'No files uploaded.' });
    }
    const jobId = input.query.jobId as string;
    if (!jobId) {
      // Cleanup files if they were uploaded without a jobId
      [...received.files, ...(received.cover || [])].forEach(f => {
        try {
          if (fs.existsSync(f.path))
            fs.unlinkSync(f.path);
        }
        catch (e) { }
      });
      return reply(400, { error: 'No active project selected. Please create or open a book project first.' });
    }
    const staged = received.files;
    const stagedCover = received.cover?.[0];
    const finalUploadDir = path.join(host.locations.upload, jobId);
    const moved: string[] = [];
    try {
      if (stagedCover && (!/^cover\.(jpg|jpeg|png|webp)$/i.test(path.basename(stagedCover.originalname)) || stagedCover.size > 10 * 1024 * 1024)) {
        throw new Error('Folder cover must be named cover.jpg, cover.jpeg, cover.png, or cover.webp and be no larger than 10 MiB.');
      }
      // Validate every staged file before committing any of them to the project.
      const probes = staged.map((file, index) => {
        host.logs.import(jobId, 'INFO', `Validating ${index + 1}/${staged.length}: "${file.originalname.replace(/\\/g, '/')}" with FFprobe.`);
        const probe = probeAudioFile(file.path);
        host.logs.import(jobId, 'INFO', `Validated "${file.originalname.replace(/\\/g, '/')}": ${probe.format}, ${probe.codec}, ${probe.sampleRate} Hz, ${probe.channels} channel(s), ${probe.durationSeconds.toFixed(2)} s.`);
        return probe;
      });
      fs.mkdirSync(finalUploadDir, { recursive: true });
      const uploadedFiles = staged.map((file, index) => {
        const finalPath = path.join(finalUploadDir, file.filename);
        fs.renameSync(file.path, finalPath);
        moved.push(finalPath);
        host.logs.import(jobId, 'INFO', `Committed ${index + 1}/${staged.length}: "${file.originalname.replace(/\\/g, '/')}" to ${finalPath}.`);
        const probe = probes[index];
        return {
          originalName: file.originalname.replace(/\\/g, '/'), filename: file.filename, path: finalPath, size: file.size,
          durationSeconds: probe.durationSeconds, bitrate: probe.bitrate, format: probe.format, codec: probe.codec,
          sampleRate: probe.sampleRate, channels: probe.channels, streamSignature: probe.streamSignature,
        };
      });
      if (stagedCover) {
        const coverPath = path.join(finalUploadDir, `cover-${randomUUID()}${path.extname(stagedCover.originalname).toLowerCase()}`);
        fs.renameSync(stagedCover.path, coverPath);
        moved.push(coverPath);
        host.logs.import(jobId, 'INFO', `Stored source-folder artwork in the import workspace: ${coverPath}.`);
      }
      host.logs.import(jobId, 'INFO', `Completed: ${uploadedFiles.length} file(s), ${(uploadedFiles.reduce((total, file) => total + file.size, 0) / 1048576).toFixed(1)} MiB, all validated and committed.`);
      return reply(200, { message: 'Successfully uploaded files.', files: uploadedFiles, uploadDir: finalUploadDir });
    }
    catch (error: any) {
      for (const file of [...staged, ...(stagedCover ? [stagedCover] : [])]) {
        try {
          if (fs.existsSync(file.path))
            fs.unlinkSync(file.path);
        }
        catch { }
      }
      for (const file of moved) {
        try {
          if (fs.existsSync(file))
            fs.unlinkSync(file);
        }
        catch { }
      }
      try {
        if (fs.existsSync(finalUploadDir) && fs.readdirSync(finalUploadDir).length === 0)
          fs.rmdirSync(finalUploadDir);
      }
      catch { }
      const message = `${error.message || 'Audio validation failed'}. No files were imported; staged files were removed.`;
      host.logs.failure(jobId, 'Import', message);
      host.logs.import(jobId, 'ERROR', `Validation or commit failed; rolled back ${moved.length} committed file(s) and removed staged files. Cause: ${error.message || 'Audio validation failed'}`);
      return reply(400, { error: 'Import failed', message });
    }
  }
  return { postYoutubeFetchInfo, postYoutubeDownload, postUploadAudio };
}
export type ImportProviders = ReturnType<typeof createImportProviders>;

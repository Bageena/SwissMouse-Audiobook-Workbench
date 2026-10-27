import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CoverArtInfo } from '../src/types';
import { MediaCache } from './media-cache';

const run = promisify(execFile);
type Artwork = { index: number; codec_name: string };

// Scanning needs tags and attached-picture headers, not chapter data, packet
// hashes, or decoded audio. Cache both present and absent artwork observations.
export class LibraryMediaReader {
  private thumbnails = new MediaCache<Uint8Array | undefined>(async (tools, file) => {
    const [ffmpeg, ffprobe] = JSON.parse(tools) as string[];
    const image = /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file);
    const artwork = image ? undefined : (await this.metadata.read(ffprobe, file)).artwork;
    if (!image && !artwork) return undefined;
    const result = await run(ffmpeg, ['-nostdin', '-v', 'error', '-i', file, '-map', image ? '0:v:0' : `0:${artwork!.index}`,
      '-frames:v', '1', '-vf', 'scale=160:160:force_original_aspect_ratio=decrease', '-c:v', 'png', '-threads', '1', '-f', 'image2pipe', 'pipe:1'],
    { encoding: 'buffer', windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
    return result.stdout;
  }, 2, 100);
  private metadata = new MediaCache(async (ffprobe, file) => {
    const result = await run(ffprobe, ['-v', 'error', '-show_entries',
      'format=duration:format_tags:stream=index,codec_type,codec_name:stream_disposition=attached_pic:stream_tags', '-of', 'json', file],
    { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
    const data = JSON.parse(result.stdout);
    return {
      tags: { ...data.streams?.find((stream: any) => stream.codec_type === 'audio')?.tags, ...data.format?.tags } as Record<string, unknown>,
      artwork: data.streams?.find((stream: any) => stream.disposition?.attached_pic === 1) as Artwork | undefined,
      durationSeconds: Number(data.format?.duration) > 0 ? Number(data.format.duration) : undefined,
    };
  });
  private covers = new MediaCache<CoverArtInfo | undefined>(async (tools, file) => {
    const [ffmpeg, ffprobe] = JSON.parse(tools) as string[];
    const { artwork } = await this.metadata.read(ffprobe, file);
    if (!artwork) return undefined;
    const copy = ['png', 'mjpeg', 'webp'].includes(artwork.codec_name);
    const result = await run(ffmpeg, ['-nostdin', '-v', 'error', '-i', file, '-map', `0:${artwork.index}`,
      '-frames:v', '1', '-c:v', copy ? 'copy' : 'png', '-threads', '1', '-f', 'image2pipe', 'pipe:1'],
    { encoding: 'buffer', windowsHide: true, timeout: 15000, maxBuffer: 10 * 1024 * 1024 });
    const bytes = result.stdout;
    const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpeg'
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : undefined;
    if (!mime) throw new Error('Embedded cover is not a readable image.');
    return { source: 'local', filename: `embedded-cover.${mime === 'jpeg' ? 'jpg' : mime}`, mimeType: `image/${mime}`,
      sizeBytes: bytes.length, url: `data:image/${mime};base64,${bytes.toString('base64')}` };
  }, 2, 16);

  async tags(ffprobe: string, file: string) { return (await this.metadata.read(ffprobe, file)).tags; }
  async duration(ffprobe: string, file: string) { return (await this.metadata.read(ffprobe, file)).durationSeconds; }
  async cover(ffmpeg: string, ffprobe: string, file: string) { return this.covers.read(JSON.stringify([ffmpeg, ffprobe]), file); }
  async thumbnail(ffmpeg: string, ffprobe: string, file: string) { return this.thumbnails.read(JSON.stringify([ffmpeg, ffprobe]), file); }
}

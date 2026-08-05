'use client';
import { upload } from '@vercel/blob/client';

/** Result of preparing a media blob for upload. */
export type PreparedMedia = {
  blob: Blob;
  mime: string;
  ext: string;
  durationSec?: number;
  width?: number;
  height?: number;
  posterDataUrl?: string;
  /** Tiny (~20px) base64 blur placeholder for instant LQIP rendering.
   *  Generated during prepareMedia for images; undefined for videos. */
  lqip?: string;
};

/** Options for media preparation. */
export type PrepareOptions = {
  /** Max width in pixels — image is downscaled if wider. Default 1080. */
  maxWidth?: number;
  /** Max height in pixels — image is downscaled if taller. Default 1080. */
  maxHeight?: number;
  /** WebP quality (0-1). Default 0.82 for feed items, 0.92 for avatars/covers. */
  quality?: number;
};

/** Maximum on-device size the upload pipeline accepts (matches the route). */
export const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
/** Soft cap for video duration (seconds) — keeps reels & stories trim-friendly. */
export const MAX_VIDEO_SEC = 60;

const SUPPORTED_VIDEO = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/3gpp',
  'video/x-msvideo',
  'video/x-matroska',
  'video/ogg',
]);
const SUPPORTED_IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Re-encode a still image to WebP at the requested quality.
 *  WebP is roughly 30-50% smaller than JPEG / PNG at perceptually equivalent
 *  quality, which is the cheapest way to make the wall feel snappy without
 *  touching the original capture pipeline. If anything goes
 *  wrong (e.g. browser without WebP encoder, OffscreenCanvas blocked,
 *  decode failure) we fall back to the original blob unchanged. */
async function transcodeImageToWebp(blob: Blob, quality = 0.92): Promise<{ blob: Blob; mime: string } | null> {
  if (typeof window === 'undefined') return null;
  try {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('image decode failed'));
        el.src = url;
      });
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) return null;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, w, h);
      const out = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/webp', quality);
      });
      if (!out || out.size === 0) return null;
      // If WebP somehow ended up larger than the original (rare for tiny PNGs),
      // keep the original — no point shipping a bigger file.
      if (out.size >= blob.size) return null;
      return { blob: out, mime: 'image/webp' };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

/** Resize an image blob to fit within maxWidth × maxHeight, output as WebP.
 *  Instagram-style: downscale on-device before upload so CDN/feed never
 *  serves a 12MP camera shot at 4000×3000 for a 400px feed tile.
 *  Falls back to original blob on any failure. */
async function resizeImageBlob(
  blob: Blob,
  maxWidth: number,
  maxHeight: number,
  quality: number,
): Promise<{ blob: Blob; mime: string; width: number; height: number } | null> {
  if (typeof window === 'undefined') return null;
  try {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('image decode failed'));
        el.src = url;
      });
      const srcW = img.naturalWidth;
      const srcH = img.naturalHeight;
      if (!srcW || !srcH) return null;

      // Only downscale — never upscale
      let w = srcW;
      let h = srcH;
      if (w > maxWidth) { h = Math.round(h * (maxWidth / w)); w = maxWidth; }
      if (h > maxHeight) { w = Math.round(w * (maxHeight / h)); h = maxHeight; }
      if (w === srcW && h === srcH && blob.type === 'image/webp') return null; // already optimal

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, w, h);

      const out = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/webp', quality);
      });
      if (!out || out.size === 0) return null;
      if (out.size >= blob.size && w === srcW && h === srcH) return null; // no benefit
      return { blob: out, mime: 'image/webp', width: w, height: h };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

/** Generate a tiny (~20px wide) blur-up LQIP data URL from an image blob.
 *  Instagram shows a blurry placeholder instantly while the full image
 *  streams in — we replicate that with a 20px thumbnail encoded to a tiny
 *  base64 data URL. Returns null on any failure. */
async function generateLqip(blob: Blob): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('lqip decode failed'));
        el.src = url;
      });
      const aspect = img.naturalHeight / img.naturalWidth;
      const tw = 20;
      const th = Math.round(tw * aspect);
      const canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th || 20;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, tw, th || 20);
      return canvas.toDataURL('image/jpeg', 0.3);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

/** Convert a `data:` URL to a Blob. */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/** Map a MIME type to a sensible extension for the blob pathname. */
export function extForMime(mime: string): string {
  switch (mime) {
    case 'video/mp4': return 'mp4';
    case 'video/webm': return 'webm';
    case 'video/quicktime': return 'mov';
    case 'video/3gpp': return '3gp';
    case 'video/x-msvideo': return 'avi';
    case 'video/x-matroska': return 'mkv';
    case 'video/ogg': return 'ogv';
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    default: return 'bin';
  }
}

/** Inspect a video Blob: duration, dimensions, and a JPEG poster from frame 0. */
export async function probeVideo(blob: Blob): Promise<{ durationSec: number; width: number; height: number; posterDataUrl: string }> {
  const url = URL.createObjectURL(blob);
  try {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.playsInline = true;
    v.src = url;
    await new Promise<void>((resolve, reject) => {
      v.onloadedmetadata = () => resolve();
      v.onerror = () => reject(new Error('Could not read video metadata'));
    });
    // Seek to the first frame so we get a real poster (some browsers won't
    // paint until they've decoded a frame).
    await new Promise<void>((resolve) => {
      const onSeek = () => { v.removeEventListener('seeked', onSeek); resolve(); };
      v.addEventListener('seeked', onSeek);
      try { v.currentTime = Math.min(0.1, (v.duration || 1) / 2); } catch { resolve(); }
    });
    const w = v.videoWidth || 720;
    const h = v.videoHeight || 1280;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    let posterDataUrl = '';
    if (ctx) {
      try { ctx.drawImage(v, 0, 0, w, h); posterDataUrl = canvas.toDataURL('image/jpeg', 0.8); } catch {}
    }
    return { durationSec: v.duration || 0, width: w, height: h, posterDataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Compress & convert a video on-device before upload.
 *  Plays through a canvas for resolution downscaling, records with
 *  MediaRecorder at an optimised bitrate. Falls back to the original
 *  blob on any failure — callers always get a valid video.
 *
 *  Target: 1080p max, up to 60fps and ~8 Mbps when re-encoding is required.
 *  Captures already within the upload budget stay untouched, preserving the
 *  native camera's original frame rate, codec and audio. */
async function compressVideo(blob: Blob): Promise<{ blob: Blob; mime: string }> {
  if (typeof window === 'undefined') return { blob, mime: blob.type || 'video/mp4' };

  let videoUrl = '';
  try {
    videoUrl = URL.createObjectURL(blob);

    // Load metadata
    const srcW = await new Promise<{ w: number; h: number; d: number }>((resolve, reject) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.playsInline = true;
      v.src = videoUrl;
      v.onloadedmetadata = () => resolve({ w: v.videoWidth || 720, h: v.videoHeight || 1280, d: v.duration || 0 });
      v.onerror = () => reject(new Error('cannot read video'));
    });

    // Preserve native 1080p/60fps captures whenever they already fit. Only
    // oversized sources are normalised to the app's high-quality upload tier.
    const needsCompress = Math.max(srcW.w, srcW.h) > 1920 || blob.size > 72 * 1024 * 1024;
    if (!needsCompress) return { blob, mime: blob.type || 'video/mp4' };

    // Calculate output dimensions (1080p short edge / 1920p long edge).
    const scale = Math.min(1, 1920 / Math.max(srcW.w, srcW.h));
    let outW = Math.round(srcW.w * scale);
    let outH = Math.round(srcW.h * scale);
    // Ensure even dimensions (required by most encoders)
    outW = outW - (outW % 2);
    outH = outH - (outH % 2);

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas context');

    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = videoUrl;

    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('video load failed'));
      video.load();
    });

    // Use MP4 with H.264 if supported, fall back to WebM
    const mimeType = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E')
      ? 'video/mp4;codecs=avc1.42E01E'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
          ? 'video/webm;codecs=vp8,opus'
          : 'video/webm';

    const chunks: Blob[] = [];
    const stream = canvas.captureStream(60);
    const sourceStream = typeof (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream === 'function'
      ? (video as HTMLVideoElement & { captureStream: () => MediaStream }).captureStream()
      : null;
    sourceStream?.getAudioTracks().forEach((track) => stream.addTrack(track));
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
      audioBitsPerSecond: 192_000,
    });

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    const recorded = new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType.split(';')[0] }));
    });

    // Draw frames and record
    video.currentTime = 0;
    await video.play();
    recorder.start();

    const drawFrame = () => {
      if (video.ended || video.paused) return;
      ctx.drawImage(video, 0, 0, outW, outH);
      requestAnimationFrame(drawFrame);
    };
    drawFrame();

    await new Promise<void>((resolve) => {
      video.onended = () => { recorder.stop(); resolve(); };
    });

    const result = await recorded;
    // Only use compressed version if it's actually smaller
    if (result.size > 0 && result.size < blob.size) {
      return { blob: result, mime: mimeType.split(';')[0] };
    }
    return { blob, mime: blob.type || 'video/mp4' };
  } catch {
    // Fall back to original blob on any failure
    return { blob, mime: blob.type || 'video/mp4' };
  } finally {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }
}

/** Prepare an image or video Blob for upload: validate, normalise MIME,
 * grab dimensions/poster, optionally downscale images to target size,
 * generate LQIP placeholder. Throws with a user-friendly message on failure. */
export async function prepareMedia(input: Blob | File, opts?: PrepareOptions): Promise<PreparedMedia> {
  const maxWidth = opts?.maxWidth ?? 1080;
  const maxHeight = opts?.maxHeight ?? 1080;
  const quality = opts?.quality ?? 0.82;

  let blob: Blob = input;
  let mime = (input.type || '').toLowerCase();
  // Normalise MediaRecorder MIME like `video/webm;codecs=vp9,opus` → `video/webm`.
  if (mime.includes(';')) mime = mime.split(';')[0].trim();

  const isVideo = mime.startsWith('video/');
  const isImage = mime.startsWith('image/');

  if (!isVideo && !isImage) {
    throw new Error('Unsupported media type');
  }
  if (isImage && !SUPPORTED_IMAGE.has(mime)) {
    mime = 'image/jpeg';
    blob = blob.slice(0, blob.size, mime);
  }

  // ── Image path: resize + WebP transcode + LQIP ──
  let lqip: string | undefined;
  let lqipPromise: Promise<string | null> | undefined;
  let finalWidth: number | undefined;
  let finalHeight: number | undefined;

  if (isImage) {
    // Step 1: downscale to target dimensions (Instagram-style on-device resize)
    const resized = await resizeImageBlob(blob, maxWidth, maxHeight, quality);
    if (resized) {
      blob = resized.blob;
      mime = resized.mime;
      finalWidth = resized.width;
      finalHeight = resized.height;
    } else if (mime !== 'image/webp') {
      // Step 2: if no resize needed (already small), still transcode to WebP
      const webp = await transcodeImageToWebp(blob, quality);
      if (webp) {
        blob = webp.blob;
        mime = webp.mime;
      }
    }
    // Step 3: generate LQIP from final blob (runs in parallel with next checks)
    lqipPromise = generateLqip(blob);
  }

  if (isVideo) {
    // ── On-device video compression: downscale + re-encode before upload ──
    try {
      const compressed = await compressVideo(blob);
      blob = compressed.blob;
      mime = compressed.mime;
    } catch { /* fall back to original */ }
  }

  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large (${(blob.size / 1024 / 1024).toFixed(1)} MB). Limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  }

  // Construct the result only after optional video processing so callers
  // receive the actual high-quality output blob and matching MIME metadata.
  const result: PreparedMedia = {
    blob,
    mime,
    ext: extForMime(mime),
  };

  if (isVideo) {
    try {
      const probe = await probeVideo(blob);
      if (probe.durationSec && probe.durationSec > MAX_VIDEO_SEC + 1) {
        throw new Error(`Video too long (${probe.durationSec.toFixed(0)}s). Limit is ${MAX_VIDEO_SEC}s.`);
      }
      result.durationSec = probe.durationSec;
      result.width = probe.width;
      result.height = probe.height;
      result.posterDataUrl = probe.posterDataUrl;
    } catch (err) {
      if (err instanceof Error && /too long|too large/i.test(err.message)) throw err;
    }
  } else {
    // Use post-resize dimensions if available, otherwise probe from source
    if (finalWidth && finalHeight) {
      result.width = finalWidth;
      result.height = finalHeight;
    }
    // Await LQIP — it was kicked off in parallel with size checks
    if (isImage) {
      try { result.lqip = await lqipPromise ?? undefined; } catch { /* best-effort */ }
    }
  }

  return result;
}

/** Upload a prepared media blob to Vercel Blob via the client-upload flow.
 * Returns the public URL. */
type UploadMediaKind = 'story' | 'reel' | 'post' | 'poll' | 'avatar' | 'cover';

export async function uploadPreparedMedia(prepared: PreparedMedia, opts: { kind: UploadMediaKind; uid: string }): Promise<string> {
  const ts = Date.now();
  const pathname = `${opts.kind}/${opts.uid}/${ts}.${prepared.ext}`;
  const result = await upload(pathname, prepared.blob, {
    access: 'public',
    handleUploadUrl: '/api/blob/upload',
    contentType: prepared.mime,
  });
  return result.url;
}

/** Upload the on-device video poster (data URL → JPEG blob) so we can store
 *  a real CDN URL on the post / reel record instead of a giant base64 blob
 *  inside RTDB. Returns null if the poster is missing or the upload fails —
 *  callers should treat poster as best-effort and fall back to the video
 *  itself or a placeholder. */
async function uploadPoster(posterDataUrl: string, opts: { kind: 'story' | 'reel' | 'post' | 'poll'; uid: string }): Promise<string | null> {
  try {
    const blob = await dataUrlToBlob(posterDataUrl);
    if (!blob || blob.size === 0) return null;
    const ts = Date.now();
    const pathname = `${opts.kind}/${opts.uid}/${ts}-poster.jpg`;
    const result = await upload(pathname, blob, {
      access: 'public',
      handleUploadUrl: '/api/blob/upload',
      contentType: 'image/jpeg',
    });
    return result.url;
  } catch {
    return null;
  }
}

/** Convenience: prepare + upload in one call. For videos we also upload the
 *  first-frame poster as a separate JPEG so consumers can render an instant
 *  thumbnail without having to download the whole video for its first frame
 *  — critical for feed grid tiles, reels rail and chat attachments on slow
 *  networks. Accepts optional PrepareOptions for resize/quality. */
export async function uploadMedia(
  input: Blob | File | string | PreparedMedia,
  opts: { kind: UploadMediaKind; uid: string } & PrepareOptions,
): Promise<{ url: string; posterUrl?: string; lqip?: string; prepared: PreparedMedia }> {
  const { kind, uid, maxWidth, maxHeight, quality } = opts;
  const prepared = isPreparedMedia(input)
    ? input
    : await prepareMedia(typeof input === 'string' ? await dataUrlToBlob(input) : input, { maxWidth, maxHeight, quality });
  // Run the main upload + poster upload in parallel for videos so the user
  // doesn't pay the latency twice.
  const isVideo = prepared.mime.startsWith('video/');
  if (isVideo && prepared.posterDataUrl && kind !== 'avatar' && kind !== 'cover') {
    const [url, posterUrl] = await Promise.all([
      uploadPreparedMedia(prepared, opts),
      uploadPoster(prepared.posterDataUrl, opts as { kind: 'story' | 'reel' | 'post' | 'poll'; uid: string }),
    ]);
    return { url, posterUrl: posterUrl ?? undefined, lqip: prepared.lqip, prepared };
  }
  const url = await uploadPreparedMedia(prepared, opts);
  return { url, lqip: prepared.lqip, prepared };
}

function isPreparedMedia(input: Blob | File | string | PreparedMedia): input is PreparedMedia {
  return typeof input === 'object'
    && input !== null
    && 'blob' in input
    && 'mime' in input
    && 'ext' in input;
}

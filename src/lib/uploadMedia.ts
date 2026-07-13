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
};

/** Maximum on-device size the upload pipeline accepts (matches the route). */
export const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
/** Soft cap for video duration (seconds) — keeps reels & stories trim-friendly. */
export const MAX_VIDEO_SEC = 60;

const SUPPORTED_VIDEO = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const SUPPORTED_IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Re-encode a still image to WebP at near-lossless quality.
 *  WebP is roughly 30-50% smaller than JPEG / PNG at perceptually equivalent
 *  quality, which is the cheapest way to make the wall feel snappy without
 *  touching the original capture pipeline. We deliberately keep the source
 *  pixel dimensions intact so camera quality is preserved. If anything goes
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

/** Prepare an image or video Blob for upload: validate, normalise MIME,
 * grab dimensions/poster. Throws with a user-friendly message on failure. */
export async function prepareMedia(input: Blob | File): Promise<PreparedMedia> {
  let blob: Blob = input;
  let mime = (input.type || '').toLowerCase();
  // Normalise MediaRecorder MIME like `video/webm;codecs=vp9,opus` → `video/webm`.
  if (mime.includes(';')) mime = mime.split(';')[0].trim();

  const isVideo = mime.startsWith('video/');
  const isImage = mime.startsWith('image/');

  if (!isVideo && !isImage) {
    throw new Error('Unsupported media type');
  }
  if (isVideo && !SUPPORTED_VIDEO.has(mime)) {
    // Most browsers record `video/webm`; some iOS Safari variants record mp4.
    // Coerce unknown video subtypes to webm so the server token accepts them.
    mime = 'video/webm';
    blob = blob.slice(0, blob.size, mime);
  }
  if (isImage && !SUPPORTED_IMAGE.has(mime)) {
    mime = 'image/jpeg';
    blob = blob.slice(0, blob.size, mime);
  }
  // Re-encode JPEG / PNG stills as WebP at high quality so the upload, the
  // CDN response, and every subsequent feed paint move less data without
  // visibly degrading the camera capture. WebP-in / WebP-out is a no-op.
  if (isImage && mime !== 'image/webp') {
    const webp = await transcodeImageToWebp(blob);
    if (webp) {
      blob = webp.blob;
      mime = webp.mime;
    }
  }
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large (${(blob.size / 1024 / 1024).toFixed(1)} MB). Limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  }

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
      // Re-throw size/duration errors verbatim; swallow probe failures so a
      // healthy file still uploads even if the probe canvas misbehaves.
      if (err instanceof Error && /too long|too large/i.test(err.message)) throw err;
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
 *  networks. */
export async function uploadMedia(input: Blob | File | string | PreparedMedia, opts: { kind: UploadMediaKind; uid: string }): Promise<{ url: string; posterUrl?: string; prepared: PreparedMedia }> {
  const prepared = isPreparedMedia(input)
    ? input
    : await prepareMedia(typeof input === 'string' ? await dataUrlToBlob(input) : input);
  // Run the main upload + poster upload in parallel for videos so the user
  // doesn't pay the latency twice.
  const isVideo = prepared.mime.startsWith('video/');
  if (isVideo && prepared.posterDataUrl && opts.kind !== 'avatar' && opts.kind !== 'cover') {
    const [url, posterUrl] = await Promise.all([
      uploadPreparedMedia(prepared, opts),
      uploadPoster(prepared.posterDataUrl, opts as { kind: 'story' | 'reel' | 'post' | 'poll'; uid: string }),
    ]);
    return { url, posterUrl: posterUrl ?? undefined, prepared };
  }
  const url = await uploadPreparedMedia(prepared, opts);
  return { url, prepared };
}

function isPreparedMedia(input: Blob | File | string | PreparedMedia): input is PreparedMedia {
  return typeof input === 'object'
    && input !== null
    && 'blob' in input
    && 'mime' in input
    && 'ext' in input;
}

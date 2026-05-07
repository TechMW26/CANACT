'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { get, ref } from 'firebase/database';
import type { ChatAttachment } from '@/lib/types';

/** True for URLs whose extension (or path) clearly indicates a video. We
 *  use it to decide whether to render the thumbnail as an <img> or as a
 *  muted, paused <video> element — the latter shows the first frame as a
 *  poster on every browser we ship to (Chromium WebView + iOS Safari +
 *  desktop), which gives us a free thumbnail for legacy posts/reels that
 *  predate the dedicated `posterUrl` / `mediaPosters` fields. */
function isVideoUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url, 'https://x.invalid');
    const path = u.pathname.toLowerCase();
    return /\.(mp4|mov|m4v|webm|ogv|3gp|mkv)(\?|$)/.test(path);
  } catch {
    return /\.(mp4|mov|m4v|webm|ogv|3gp|mkv)(\?|$)/.test(url.toLowerCase());
  }
}

/**
 * In-chat preview card for shared posts/reels. Renders a compact bubble that
 * navigates to the underlying post/reel when tapped. We intentionally ship a
 * thumbnail-only preview (no full-resolution media, no player chrome) so the
 * chat list stays light on bandwidth and lays out instantly even on slow
 * networks.
 */
export function ChatAttachmentCard({ attachment }: { attachment: ChatAttachment; mine?: boolean }) {
  // `thumb` is whatever paints in the preview tile. `thumbIsVideo` tells the
  // render path whether to use <img> or a paused <video> first-frame poster.
  const [thumb, setThumb] = useState<string | undefined>(attachment.thumbUrl);
  const [thumbIsVideo, setThumbIsVideo] = useState<boolean>(false);
  const [text, setText] = useState<string | undefined>(
    attachment.kind === 'post' ? attachment.text
      : attachment.kind === 'poll' ? attachment.question
      : attachment.kind === 'reel' ? attachment.caption
      : undefined,
  );
  const [author, setAuthor] = useState<string | undefined>(attachment.authorName);
  const [authorUid, setAuthorUid] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    if (thumb && author) return;
    (async () => {
      try {
        if (attachment.kind === 'post') {
          const snap = await get(ref(db, `wha/${attachment.postId}`));
          const v = snap.val();
          if (cancelled || !v) return;
          // Prefer the dedicated poster (cheap JPEG generated at upload
          // time). Fall back to the first media URL — if that turns out
          // to be a video we'll render its first frame via <video>.
          if (!thumb) {
            const poster = v.mediaPosters?.[0] as string | undefined;
            const first = v.mediaUrls?.[0] as string | undefined;
            if (poster) {
              setThumb(poster);
              setThumbIsVideo(false);
            } else if (first) {
              setThumb(first);
              setThumbIsVideo(isVideoUrl(first));
            }
          }
          if (!text && v.text) setText(v.text);
          if (!author && v.authorName) setAuthor(v.authorName);
        } else if (attachment.kind === 'poll') {
          const snap = await get(ref(db, `polls/${attachment.pollId}`));
          const v = snap.val();
          if (cancelled || !v) return;
          if (!text && v.question) setText(v.question);
          if (!author && v.authorName) setAuthor(v.authorName);
        } else if (attachment.kind === 'reel') {
          const snap = await get(ref(db, `reels/${attachment.reelId}`));
          const v = snap.val();
          if (cancelled || !v) return;
          if (!thumb) {
            if (v.posterUrl) {
              setThumb(v.posterUrl);
              setThumbIsVideo(false);
            } else if (v.videoUrl) {
              // Legacy reel without a poster — render the video element
              // muted + paused so the browser paints the first frame as
              // a thumbnail. Tapping the card still navigates to /reel.
              setThumb(v.videoUrl);
              setThumbIsVideo(true);
            }
          }
          if (!text && v.caption) setText(v.caption);
          if (!author && v.authorName) setAuthor(v.authorName);
        } else {
          const snap = await get(ref(db, `ratemeSessions/${attachment.sessionId}`));
          const v = snap.val();
          if (cancelled || !v) return;
          if (!thumb && v.photoURL) setThumb(v.photoURL);
          if (!author && v.authorName) setAuthor(v.authorName);
          if (v.uid) setAuthorUid(v.uid);
        }
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [attachment, thumb, text, author]);

  // If the attachment payload itself only carried a video URL as `thumbUrl`,
  // detect it on mount so the very first paint gets the right element.
  useEffect(() => {
    if (attachment.thumbUrl && isVideoUrl(attachment.thumbUrl)) setThumbIsVideo(true);
  }, [attachment.thumbUrl]);

  const href =
    attachment.kind === 'post' ? `/post/${attachment.postId}`
    : attachment.kind === 'poll' ? `/poll/${attachment.pollId}`
    : attachment.kind === 'reel' ? `/reel/${attachment.reelId}`
    : authorUid ? `/profile/${authorUid}` : '/feed';
  const label = attachment.kind === 'post' ? 'Post' : attachment.kind === 'poll' ? 'Poll' : attachment.kind === 'reel' ? 'Reel' : 'Rate Me';

  return (
    <Link
      href={href}
      prefetch
      className="block w-64 overflow-hidden rounded-2xl border border-line bg-white text-ink"
    >
      <div className="relative aspect-[4/5] bg-brand-light/40">
        {thumb ? (
          thumbIsVideo ? (
            // muted + playsInline + preload=metadata makes the WebView
            // download just the first sample to render the poster
            // frame; we never play() so it stays a still thumbnail.
            <video
              src={thumb}
              muted
              playsInline
              preload="metadata"
              // Append #t=0.1 so the browser seeks slightly past the
              // very first frame — many encoders leave the 0.0s frame
              // black/blank, which would defeat the purpose.
              poster={undefined}
              className="h-full w-full object-cover"
              onLoadedMetadata={(e) => { try { (e.currentTarget as HTMLVideoElement).currentTime = 0.1; } catch { /* noop */ } }}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
          )
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-ink/50">{label}</div>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white shadow">
          {label}
        </span>
      </div>
      <div className="px-3 py-2.5">
        {author && <div className="truncate text-sm font-extrabold text-ink">{author}</div>}
        {text && <div className="mt-0.5 line-clamp-2 text-xs leading-snug text-ink/70">{text}</div>}
        <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-brand-light px-2.5 py-1 text-[11px] font-bold text-brand">
          Open {label.toLowerCase()} →
        </div>
      </div>
    </Link>
  );
}

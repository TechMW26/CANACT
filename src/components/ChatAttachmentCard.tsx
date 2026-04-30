'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { db } from '@/lib/firebase';
import { get, ref } from 'firebase/database';
import type { ChatAttachment } from '@/lib/types';

/**
 * In-chat preview card for shared posts/reels. Renders a compact bubble that
 * navigates to the underlying post/reel when tapped.
 */
export function ChatAttachmentCard({ attachment }: { attachment: ChatAttachment; mine?: boolean }) {
  const [thumb, setThumb] = useState<string | undefined>(attachment.thumbUrl);
  const [text, setText] = useState<string | undefined>(
    attachment.kind === 'post' ? attachment.text
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
          const snap = await get(ref(db, `whaPosts/${attachment.postId}`));
          const v = snap.val();
          if (cancelled || !v) return;
          if (!thumb && v.mediaUrls?.[0]) setThumb(v.mediaUrls[0]);
          if (!text && v.text) setText(v.text);
          if (!author && v.authorName) setAuthor(v.authorName);
        } else if (attachment.kind === 'reel') {
          const snap = await get(ref(db, `reels/${attachment.reelId}`));
          const v = snap.val();
          if (cancelled || !v) return;
          if (!thumb && (v.posterUrl || v.videoUrl)) setThumb(v.posterUrl || v.videoUrl);
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

  const href =
    attachment.kind === 'post' ? `/post/${attachment.postId}`
    : attachment.kind === 'reel' ? `/reel/${attachment.reelId}`
    : authorUid ? `/profile/${authorUid}` : '/feed';
  const label = attachment.kind === 'post' ? 'Post' : attachment.kind === 'reel' ? 'Reel' : 'Rate Me';

  return (
    <Link
      href={href}
      prefetch
      className="block w-64 overflow-hidden rounded-2xl border border-line bg-white text-ink shadow-[0_8px_22px_-12px_rgba(10,10,10,0.18)]"
    >
      <div className="relative aspect-[4/5] bg-brand-light/40">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
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

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
export function ChatAttachmentCard({ attachment, mine }: { attachment: ChatAttachment; mine: boolean }) {
  const [thumb, setThumb] = useState<string | undefined>(attachment.thumbUrl);
  const [text, setText] = useState<string | undefined>(
    attachment.kind === 'post' ? attachment.text : attachment.caption,
  );
  const [author, setAuthor] = useState<string | undefined>(attachment.authorName);

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
        } else {
          const snap = await get(ref(db, `reels/${attachment.reelId}`));
          const v = snap.val();
          if (cancelled || !v) return;
          if (!thumb && (v.posterUrl || v.videoUrl)) setThumb(v.posterUrl || v.videoUrl);
          if (!text && v.caption) setText(v.caption);
          if (!author && v.authorName) setAuthor(v.authorName);
        }
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [attachment, thumb, text, author]);

  const href = attachment.kind === 'post' ? `/post/${attachment.postId}` : `/reel/${attachment.reelId}`;
  const label = attachment.kind === 'post' ? 'Post' : 'Reel';

  return (
    <Link
      href={href}
      className={`block w-60 overflow-hidden rounded-2xl border ${mine ? 'border-white/30 bg-white/10' : 'border-line bg-white'}`}
    >
      <div className="relative aspect-[4/5] bg-black/10">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-ink/50">{label}</div>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
          {label}
        </span>
      </div>
      <div className={`px-3 py-2 text-xs ${mine ? 'text-white' : 'text-ink'}`}>
        {author && <div className="font-extrabold truncate">{author}</div>}
        {text && <div className={`mt-0.5 line-clamp-2 ${mine ? 'text-white/85' : 'text-ink/70'}`}>{text}</div>}
      </div>
    </Link>
  );
}

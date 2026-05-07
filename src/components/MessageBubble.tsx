'use client';
import { memo, useEffect, useRef, useState } from 'react';
import { CornerUpLeft, Heart } from './icons';
import { ChatAttachmentCard } from './ChatAttachmentCard';
import { haptic } from '@/lib/haptics';
import type { ChatMessage } from '@/lib/types';

const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '🔥', '👍'];

/** Format a timestamp as 24-hour HH:MM in the user's locale. */
function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/** Centered date divider used between message groups. Renders nothing when
 *  the next message is on the same calendar day as the previous one. */
export function ChatDateDivider({ ts }: { ts: number }) {
  const label = formatDateLabel(ts);
  return (
    <li className="my-3 flex items-center justify-center">
      <span className="rounded-full bg-ink/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink/55">
        {label}
      </span>
    </li>
  );
}

/** "Today" / "Yesterday" / "Wednesday" (for last 7 days) / "12 May 2025". */
function formatDateLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTarget = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfToday - startOfTarget) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) {
    return d.toLocaleDateString([], { weekday: 'long' });
  }
  return d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Returns true if `a` and `b` fall on different calendar days. */
export function isDifferentDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() !== db.getFullYear() ||
    da.getMonth() !== db.getMonth() ||
    da.getDate() !== db.getDate()
  );
}

/**
 * Single chat message row with full Instagram-style gestures:
 *  - Swipe right → reply
 *  - Double-tap → quick ❤️ (toggle)
 *  - Long-press → reaction picker + actions menu (Reply / Copy / Edit / Delete)
 */
export function MessageBubble(props: MessageBubbleProps) {
  return <MessageBubbleInner {...props} />;
}

type MessageBubbleProps = {
  message: ChatMessage;
  mine: boolean;
  myUid: string;
  onReply: (m: ChatMessage) => void;
  onReact: (m: ChatMessage, emoji: string | null) => void;
  onLongPress: (m: ChatMessage, anchor: { x: number; y: number }) => void;
  onDoubleTap: (m: ChatMessage) => void;
};

/** Memoised heavy renderer — keeps long chats from rerendering every
 *  bubble whenever a sibling state (composer, reply target, etc.) changes. */
const MessageBubbleInner = memo(function MessageBubbleInner({
  message,
  mine,
  myUid,
  onReply,
  onReact,
  onLongPress,
  onDoubleTap,
}: MessageBubbleProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState(0);
  const startX = useRef(0);
  const startY = useRef(0);
  const moved = useRef(false);
  const horiz = useRef(false);
  const longPressTimer = useRef<number | null>(null);
  const lastTap = useRef(0);

  function clearLongPress() {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    startX.current = t.clientX;
    startY.current = t.clientY;
    moved.current = false;
    horiz.current = false;
    longPressTimer.current = window.setTimeout(() => {
      haptic('strong');
      const rect = wrapRef.current?.getBoundingClientRect();
      onLongPress(message, {
        x: rect ? rect.left + rect.width / 2 : t.clientX,
        y: rect ? rect.top : t.clientY,
      });
    }, 380);
  }

  function onTouchMove(e: React.TouchEvent) {
    const t = e.touches[0];
    const dx = t.clientX - startX.current;
    const dy = t.clientY - startY.current;
    if (!moved.current && Math.hypot(dx, dy) > 6) {
      moved.current = true;
      horiz.current = Math.abs(dx) > Math.abs(dy);
      clearLongPress();
    }
    if (horiz.current) {
      // Only allow reply gesture in the natural direction (right for incoming, left for own).
      const allowed = mine ? Math.min(0, dx) : Math.max(0, dx);
      const clamped = Math.max(-90, Math.min(90, allowed));
      setDrag(clamped);
      if (Math.abs(clamped) > 60) e.preventDefault();
    }
  }

  function onTouchEnd() {
    clearLongPress();
    if (horiz.current && Math.abs(drag) > 56) {
      haptic('selection');
      onReply(message);
    }
    setDrag(0);
    if (!moved.current) {
      const now = Date.now();
      if (now - lastTap.current < 280) {
        haptic('strong');
        onDoubleTap(message);
        lastTap.current = 0;
      } else {
        lastTap.current = now;
      }
    }
  }

  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    const rect = wrapRef.current?.getBoundingClientRect();
    onLongPress(message, {
      x: rect ? rect.left + rect.width / 2 : e.clientX,
      y: rect ? rect.top : e.clientY,
    });
  }

  // Reactions cluster
  const reactionEntries = Object.entries(message.reactions || {});
  const reactionCounts: Record<string, number> = {};
  reactionEntries.forEach(([, e]) => { reactionCounts[e] = (reactionCounts[e] ?? 0) + 1; });
  const myReaction = message.reactions?.[myUid];

  return (
    <div
      ref={wrapRef}
      className={`relative flex w-full ${mine ? 'justify-end' : 'justify-start'}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onContextMenu={onContextMenu}
    >
      {/* Reply hint icon revealed under the swipe */}
      {Math.abs(drag) > 8 && (
        <div
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 ${mine ? 'right-0' : 'left-0'} flex items-center text-brand`}
          style={{ opacity: Math.min(1, Math.abs(drag) / 56) }}
        >
          <CornerUpLeft size={20} />
        </div>
      )}

      <div
        className="max-w-[78%] flex flex-col gap-1 will-change-transform"
        style={{ transform: `translateX(${drag}px)`, transition: drag === 0 ? 'transform 180ms ease' : 'none' }}
      >
        {message.replyTo && (
          <div className={`max-w-full overflow-hidden rounded-xl border-l-2 ${mine ? 'border-white/70 bg-white/10 text-white/85' : 'border-brand bg-brand-light/40 text-ink/70'} px-2 py-1 text-[11px]`}>
            <div className="font-extrabold opacity-80">
              {message.replyTo.fromUid === myUid ? 'You' : 'Reply'}
            </div>
            <div className="line-clamp-2 opacity-90">{message.replyTo.text || 'Attachment'}</div>
          </div>
        )}

        {message.attachment && (
          <div className={mine ? 'self-end' : 'self-start'}>
            <ChatAttachmentCard attachment={message.attachment} mine={mine} />
          </div>
        )}

        {message.deleted ? (
          <div className={`rounded-2xl px-3 py-2 text-sm italic ${mine ? 'bg-brand/40 text-white/80' : 'bg-brand-light/60 text-ink/55'}`}>
            Message deleted
          </div>
        ) : message.text ? (
          <div
            className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
              mine ? 'bg-brand text-white' : 'bg-white text-ink ring-1 ring-line'
            }`}
          >
            {message.text}
            {message.editedAt && (
              <span className={`ml-2 text-[10px] ${mine ? 'text-white/70' : 'text-ink/45'}`}>edited</span>
            )}
          </div>
        ) : null}

        {/* Per-message HH:MM timestamp, Instagram-style — small, muted,
            aligned to the bubble side. The full date lives on the
            divider row above so this stays unobtrusive. */}
        <span className={`text-[10px] text-ink/40 ${mine ? 'self-end pr-1' : 'self-start pl-1'}`}>
          {formatTime(message.createdAt)}
        </span>

        {reactionEntries.length > 0 && (
          <div className={`relative h-3 ${mine ? 'self-end' : 'self-start'}`}>
            <div
              key={reactionEntries.map(([, e]) => e).join(',') + ':' + reactionEntries.length}
              className={`canact-reaction-pop absolute -top-3 ${mine ? 'right-2' : 'left-2'} flex items-center gap-0.5 rounded-full bg-white px-1.5 py-0.5 ring-1 ring-line`}
            >
              {Object.entries(reactionCounts).map(([emoji, count]) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onReact(message, myReaction === emoji ? null : emoji)}
                  className={`flex items-center gap-0.5 rounded-full px-1 leading-none transition ${myReaction === emoji ? 'scale-110' : ''}`}
                >
                  <span className="text-[14px]">{emoji}</span>
                  {count > 1 && <span className="text-[10px] font-bold text-ink/70">{count}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export { QUICK_REACTIONS };

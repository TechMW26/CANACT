'use client';
import { useEffect, useRef, useState } from 'react';
import { CornerUpLeft, Heart } from './icons';
import { ChatAttachmentCard } from './ChatAttachmentCard';
import { haptic } from '@/lib/haptics';
import type { ChatMessage } from '@/lib/types';

const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '🔥', '👍'];

/**
 * Single chat message row with full Instagram-style gestures:
 *  - Swipe right → reply
 *  - Double-tap → quick ❤️ (toggle)
 *  - Long-press → reaction picker + actions menu (Reply / Copy / Edit / Delete)
 */
export function MessageBubble({
  message,
  mine,
  myUid,
  onReply,
  onReact,
  onLongPress,
  onDoubleTap,
}: {
  message: ChatMessage;
  mine: boolean;
  myUid: string;
  onReply: (m: ChatMessage) => void;
  onReact: (m: ChatMessage, emoji: string | null) => void;
  onLongPress: (m: ChatMessage, anchor: { x: number; y: number }) => void;
  onDoubleTap: (m: ChatMessage) => void;
}) {
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
            className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm shadow-sm ${
              mine ? 'bg-brand text-white' : 'bg-white text-ink ring-1 ring-line'
            }`}
          >
            {message.text}
            {message.editedAt && (
              <span className={`ml-2 text-[10px] ${mine ? 'text-white/70' : 'text-ink/45'}`}>edited</span>
            )}
          </div>
        ) : null}

        {reactionEntries.length > 0 && (
          <div className={`flex ${mine ? 'justify-end' : 'justify-start'} -mt-1`}>
            <div className="flex items-center gap-1 rounded-full border border-line bg-white px-2 py-0.5 text-[12px] shadow-sm">
              {Object.entries(reactionCounts).map(([emoji, count]) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onReact(message, myReaction === emoji ? null : emoji)}
                  className={`leading-none ${myReaction === emoji ? 'opacity-100' : 'opacity-90'}`}
                >
                  <span>{emoji}</span>
                  {count > 1 && <span className="ml-0.5 text-[10px] font-bold text-ink/70">{count}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { QUICK_REACTIONS };

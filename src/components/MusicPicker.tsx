'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MUSIC_LIBRARY, type MusicTrack } from '@/lib/musicLibrary';
import { useTopScrollSwipeDismiss } from '@/lib/useTopScrollSwipeDismiss';
import { Music, Search, X } from './icons';

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (track: MusicTrack) => void;
}

export function MusicPicker({ open, onClose, onPick }: Props) {
  const [q, setQ] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const swipeDismissHandlers = useTopScrollSwipeDismiss({
    onClose,
    getScrollElement: () => listRef.current,
  });

  useEffect(() => {
    if (!open) {
      audioRef.current?.pause();
      setPreviewId(null);
    }
  }, [open]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const list = MUSIC_LIBRARY.filter(
    (t) =>
      !q.trim() ||
      t.title.toLowerCase().includes(q.toLowerCase()) ||
      t.artist.toLowerCase().includes(q.toLowerCase()),
  );

  const togglePreview = (t: MusicTrack) => {
    if (previewId === t.id) {
      audioRef.current?.pause();
      setPreviewId(null);
      return;
    }
    if (audioRef.current) audioRef.current.pause();
    const a = new Audio(t.url);
    a.volume = 0.6;
    a.play().catch(() => {});
    audioRef.current = a;
    setPreviewId(t.id);
  };

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-end justify-center" role="dialog" aria-modal="true">
      <button aria-label="Close music" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div
        {...swipeDismissHandlers}
        style={{ maxHeight: '80svh', paddingBottom: 'var(--canact-popup-bottom-inset)' }}
        className="relative flex w-[100vw] max-w-[100vw] flex-col overflow-hidden rounded-t-3xl bg-white p-4 lg:w-full lg:max-w-md"
      >
        <div className="mb-3 flex items-center gap-2">
          <Music size={18} className="text-brand" />
          <div className="text-sm font-extrabold text-ink">Add music</div>
          <button onClick={onClose} aria-label="Close" className="ml-auto rounded-full p-2 hover:bg-brand-light">
            <X size={18} />
          </button>
        </div>
        <label className="mb-3 flex items-center gap-2 rounded-full border border-ink/10 bg-candy px-3 py-2">
          <Search size={16} className="text-ink/50" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title or artist"
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
        <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
          {list.map((t) => (
            <li key={t.id} className="flex items-center gap-3 border-b border-ink/5 py-2">
              <button
                onClick={() => togglePreview(t)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-light text-brand"
                aria-label={previewId === t.id ? 'Pause' : 'Preview'}
              >
                {previewId === t.id ? '❚❚' : '▶'}
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-ink">{t.title}</div>
                <div className="truncate text-xs text-ink/55">{t.artist}</div>
              </div>
              <button
                onClick={() => {
                  audioRef.current?.pause();
                  setPreviewId(null);
                  onPick(t);
                  onClose();
                }}
                className="rounded-full bg-brand px-3 py-1 text-xs font-extrabold text-white"
              >
                Use
              </button>
            </li>
          ))}
          {list.length === 0 && (
            <li className="py-8 text-center text-sm text-ink/50">No tracks match “{q}”.</li>
          )}
        </ul>
        <div className="pt-2 text-center text-[10px] text-ink/40">
          Tracks are royalty-free. Provided via the Pixabay Content License.
        </div>
      </div>
    </div>,
    document.body,
  );
}

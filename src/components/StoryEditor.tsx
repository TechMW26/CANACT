'use client';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Plus, Send, Trash2, Type, Sparkles } from './icons';
import type { StoryOverlay } from '@/lib/types';
import { FilterStrip } from './FilterStrip';
import { filterCss, type MediaFilterId } from '@/lib/mediaFilters';

const COLORS = ['#FFFFFF', '#0A0A0A', '#1F6B55', '#FFD43B', '#22C55E', '#3B82F6', '#A855F7'];
const BG_OPTIONS: Array<{ id: string; bg?: string; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'pill', bg: 'rgba(0,0,0,0.55)', label: 'Pill' },
  { id: 'white', bg: 'rgba(255,255,255,0.85)', label: 'Light' },
  { id: 'brand', bg: '#1F6B55', label: 'Brand' },
];

export function StoryEditor({
  imageUrl,
  onCancel,
  onShare,
}: {
  imageUrl: string;
  onCancel: () => void;
  onShare: (overlays: StoryOverlay[], caption?: string, filter?: MediaFilterId, durationHours?: 12 | 24 | 48 | 72) => void | Promise<void>;
}) {
  const [overlays, setOverlays] = useState<StoryOverlay[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [filter, setFilter] = useState<MediaFilterId>('none');
  const [showFilters, setShowFilters] = useState(false);
  const [busy, setBusy] = useState(false);
  const [durationHours, setDurationHours] = useState<12 | 24 | 48 | 72>(24);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);

  const addText = () => {
    const id = Math.random().toString(36).slice(2, 9);
    setOverlays((curr) => [
      ...curr,
      { id, text: 'Tap to edit', x: 0.5, y: 0.5, color: '#FFFFFF', background: 'rgba(0,0,0,0.55)' },
    ]);
    setEditingId(id);
  };

  const updateOverlay = (id: string, patch: Partial<StoryOverlay>) => {
    setOverlays((curr) => curr.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  };

  const removeOverlay = (id: string) => {
    setOverlays((curr) => curr.filter((o) => o.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const onPointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const stage = stageRef.current;
    const target = e.currentTarget as HTMLElement;
    if (!stage) return;
    target.setPointerCapture(e.pointerId);
    const sr = stage.getBoundingClientRect();
    const tr = target.getBoundingClientRect();
    dragRef.current = {
      id,
      offsetX: e.clientX - (tr.left + tr.width / 2),
      offsetY: e.clientY - (tr.top + tr.height / 2),
    };
    setEditingId(id);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const stage = stageRef.current;
    if (!drag || !stage) return;
    const rect = stage.getBoundingClientRect();
    const x = (e.clientX - drag.offsetX - rect.left) / rect.width;
    const y = (e.clientY - drag.offsetY - rect.top) / rect.height;
    updateOverlay(drag.id, {
      x: Math.min(0.97, Math.max(0.03, x)),
      y: Math.min(0.97, Math.max(0.03, y)),
    });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const editing = overlays.find((o) => o.id === editingId) ?? null;

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div data-canact-popup="true" className="canact-popup-layer fixed inset-0 bg-black text-white">
      <div className="relative mx-auto flex h-full max-w-md flex-col">
        <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 pt-4 safe-top">
          <button
            type="button"
            onClick={onCancel}
            aria-label="Back"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-ink"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              aria-pressed={showFilters}
              className={`inline-flex items-center gap-1 rounded-full bg-white px-3 py-2 text-xs font-bold text-ink ${showFilters ? 'ring-2 ring-brand/20' : ''}`}
            >
              <Sparkles size={14} /> Filters
            </button>
            <button
              type="button"
              onClick={addText}
              className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-2 text-xs font-bold text-ink"
            >
              <Type size={14} /> Add text
            </button>
          </div>
        </div>

        <div
          ref={stageRef}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={() => setEditingId(null)}
          className="relative flex-1 overflow-hidden"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ filter: filterCss(filter) }} />
          {overlays.map((o) => (
            <div
              key={o.id}
              onPointerDown={(e) => onPointerDown(e, o.id)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingId(o.id);
              }}
              className="absolute -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none select-none px-3 py-1.5"
              style={{
                left: `${o.x * 100}%`,
                top: `${o.y * 100}%`,
                color: o.color ?? '#fff',
                background: o.background,
                borderRadius: o.background ? 14 : 0,
                fontWeight: 800,
                fontSize: 24,
                textShadow: o.background ? 'none' : '0 2px 12px rgba(0,0,0,0.55)',
                outline: editingId === o.id ? '2px solid rgba(255,255,255,0.85)' : 'none',
                outlineOffset: 4,
              }}
            >
              {o.text || ' '}
            </div>
          ))}
        </div>

        {editing ? (
          <div className="absolute inset-x-0 bottom-0 z-20 space-y-3 bg-gradient-to-t from-black/80 via-black/55 to-transparent px-4 pb-6 pt-8 safe-bottom">
            <input
              autoFocus
              value={editing.text}
              onChange={(e) => updateOverlay(editing.id, { text: e.target.value })}
              placeholder="Type something…"
              className="w-full rounded-2xl bg-white px-4 py-3 text-base font-bold text-ink placeholder:text-ink/45 outline-none"
            />
            <div className="flex flex-wrap items-center gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => updateOverlay(editing.id, { color: c })}
                  aria-label={`Color ${c}`}
                  className={`h-7 w-7 rounded-full ring-2 ${editing.color === c ? 'ring-white' : 'ring-white/30'}`}
                  style={{ background: c }}
                />
              ))}
              <button
                type="button"
                onClick={() => removeOverlay(editing.id)}
                aria-label="Delete text"
                className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/15"
              >
                <Trash2 size={16} />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {BG_OPTIONS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => updateOverlay(editing.id, { background: b.bg })}
                  className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${editing.background === b.bg ? 'bg-white text-ink ring-white' : 'bg-white/10 ring-white/30'}`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="absolute inset-x-0 bottom-0 z-20 space-y-3 bg-gradient-to-t from-black/70 to-transparent px-4 pb-6 pt-6 safe-bottom">
            {showFilters ? (
              <FilterStrip thumbUrl={imageUrl} selected={filter} onChange={setFilter} />
            ) : null}
            <div className="flex items-center gap-1.5" aria-label="Story expiry">
              <span className="mr-1 text-xs font-bold text-white/75">Expires</span>
              {([12, 24, 48, 72] as const).map((hours) => (
                <button key={hours} type="button" onClick={() => setDurationHours(hours)} className={`rounded-full px-2.5 py-1 text-xs font-bold ${durationHours === hours ? 'bg-white text-ink' : 'bg-white/15 text-white'}`}>{hours}h</button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Add a caption (optional)"
                className="flex-1 rounded-full bg-white px-4 py-3 text-sm text-ink placeholder:text-ink/45 outline-none"
              />
              <button
                type="button"
                onClick={addText}
                aria-label="Add text"
                className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white text-ink"
              >
                <Plus size={18} />
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onShare(overlays, caption.trim() || undefined, filter, durationHours);
                  } finally {
                    setBusy(false);
                  }
                }}
                aria-label="Share story"
                className="inline-flex h-12 items-center gap-2 rounded-full bg-brand px-5 font-extrabold disabled:opacity-60"
              >
                <Send size={16} /> Share
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

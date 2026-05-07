'use client';
import { useEffect, useRef, useState } from 'react';
import { Sheet } from './Sheet';
import { Check, Loader2, RotateCcw, SlidersHorizontal } from './icons';

type EditState = {
  zoom: number;
  offsetX: number;
  offsetY: number;
  rotate: number;
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
};

const DEFAULT_EDIT: EditState = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  rotate: 0,
  brightness: 1,
  contrast: 1,
  saturation: 1,
  warmth: 0,
};

const AVATAR_SIZE = 768;

export function ProfileImageEditorSheet({
  file,
  open,
  busy,
  onClose,
  onApply,
}: {
  file: File | null;
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onApply: (blob: Blob) => Promise<void> | void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  const [edit, setEdit] = useState<EditState>(DEFAULT_EDIT);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open || !file) return;
    setEdit(DEFAULT_EDIT);
    setReady(false);
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      setReady(true);
    };
    image.onerror = () => setReady(false);
    image.src = url;
    return () => {
      URL.revokeObjectURL(url);
      imageRef.current = null;
      dragRef.current = null;
    };
  }, [file, open]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !ready) return;
    drawEditedAvatar(canvas, image, edit);
  }, [edit, ready]);

  const update = <K extends keyof EditState>(key: K, value: EditState[K]) => {
    setEdit((current) => ({ ...current, [key]: value }));
  };

  const apply = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !ready || busy) return;
    const blob = await canvasToBlob(canvas, 'image/webp', 0.94) || await canvasToBlob(canvas, 'image/jpeg', 0.92);
    if (blob) await onApply(blob);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!ready || busy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: edit.offsetX,
      offsetY: edit.offsetY,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const nextX = drag.offsetX + ((event.clientX - drag.startX) / Math.max(rect.width, 1)) * 100;
    const nextY = drag.offsetY + ((event.clientY - drag.startY) / Math.max(rect.height, 1)) * 100;
    setEdit((current) => ({
      ...current,
      offsetX: clamp(nextX, -55, 55),
      offsetY: clamp(nextY, -55, 55),
    }));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  return (
    <Sheet open={open} onClose={busy ? () => {} : onClose} title="Edit photo" topmost>
      <div className="space-y-4">
        <div className="mx-auto aspect-square w-full max-w-[320px] overflow-hidden rounded-full bg-ink/5 ring-1 ring-line">
          <canvas
            ref={canvasRef}
            width={AVATAR_SIZE}
            height={AVATAR_SIZE}
            className="h-full w-full touch-none cursor-grab active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => update('rotate', (edit.rotate - 90) % 360)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-line bg-white px-3 text-sm font-semibold text-ink"
          >
            <RotateCcw size={15} /> Rotate
          </button>
          <button
            type="button"
            onClick={() => setEdit(DEFAULT_EDIT)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-line bg-white px-3 text-sm font-semibold text-ink"
          >
            <SlidersHorizontal size={15} /> Reset
          </button>
        </div>

        <div className="space-y-3 rounded-3xl border border-line bg-white p-3">
          <RangeControl label="Zoom" min={1} max={3} step={0.01} value={edit.zoom} onChange={(value) => update('zoom', value)} />
          <RangeControl label="Left / right" min={-55} max={55} step={1} value={edit.offsetX} onChange={(value) => update('offsetX', value)} />
          <RangeControl label="Up / down" min={-55} max={55} step={1} value={edit.offsetY} onChange={(value) => update('offsetY', value)} />
        </div>

        <div className="space-y-3 rounded-3xl border border-line bg-white p-3">
          <RangeControl label="Brightness" min={0.8} max={1.25} step={0.01} value={edit.brightness} onChange={(value) => update('brightness', value)} />
          <RangeControl label="Contrast" min={0.8} max={1.3} step={0.01} value={edit.contrast} onChange={(value) => update('contrast', value)} />
          <RangeControl label="Colour" min={0.65} max={1.45} step={0.01} value={edit.saturation} onChange={(value) => update('saturation', value)} />
          <RangeControl label="Warmth" min={-1} max={1} step={0.01} value={edit.warmth} onChange={(value) => update('warmth', value)} />
        </div>

        <button
          type="button"
          disabled={!ready || busy}
          onClick={apply}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand px-5 text-base font-bold text-white disabled:opacity-55"
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
          Set photo
        </button>
      </div>
    </Sheet>
  );
}

function RangeControl({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-ink/55">
        <span>{label}</span>
        <span>{value.toFixed(step < 1 ? 2 : 0)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-brand"
      />
    </label>
  );
}

function drawEditedAvatar(canvas: HTMLCanvasElement, image: HTMLImageElement, edit: EditState) {
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  context.save();
  context.filter = `brightness(${edit.brightness}) contrast(${edit.contrast}) saturate(${edit.saturation})`;
  context.translate(AVATAR_SIZE / 2 + (edit.offsetX / 100) * AVATAR_SIZE, AVATAR_SIZE / 2 + (edit.offsetY / 100) * AVATAR_SIZE);
  context.rotate((edit.rotate * Math.PI) / 180);
  const coverScale = Math.max(AVATAR_SIZE / image.naturalWidth, AVATAR_SIZE / image.naturalHeight) * edit.zoom;
  const width = image.naturalWidth * coverScale;
  const height = image.naturalHeight * coverScale;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, -width / 2, -height / 2, width, height);
  context.restore();
  if (edit.warmth !== 0) {
    context.globalCompositeOperation = edit.warmth > 0 ? 'soft-light' : 'multiply';
    context.fillStyle = edit.warmth > 0
      ? `rgba(255, 168, 92, ${Math.abs(edit.warmth) * 0.22})`
      : `rgba(92, 142, 255, ${Math.abs(edit.warmth) * 0.16})`;
    context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
    context.globalCompositeOperation = 'source-over';
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), type, quality));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
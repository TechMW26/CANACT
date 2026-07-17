'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import styles from './Toaster.module.css';

type Toast = { id: number; text: string; kind: 'info' | 'error' | 'success' };
type DragPoint = { x: number; y: number };
let pushFn: ((toast: Omit<Toast, 'id'>) => void) | null = null;

export function toast(text: string, kind: Toast['kind'] = 'info') {
  pushFn?.({ text, kind });
}

function ToastItem({ item, onDismiss }: { item: Toast; onDismiss: (id: number) => void }) {
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<DragPoint>({ x: 0, y: 0 });
  const [exiting, setExiting] = useState(false);

  const dismiss = useCallback((vector: DragPoint = { x: 0, y: -36 }) => {
    if (exiting) return;
    const distance = Math.hypot(vector.x, vector.y) || 1;
    const travel = Math.max(180, Math.min(360, window.innerWidth * .55));
    setDrag({ x: vector.x / distance * travel, y: vector.y / distance * travel });
    setExiting(true);
  }, [exiting]);

  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(), 4200);
    return () => window.clearTimeout(timer);
  }, [dismiss]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || exiting) return;
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointer.current || pointer.current.id !== event.pointerId || exiting) return;
    setDrag({ x: event.clientX - pointer.current.x, y: event.clientY - pointer.current.y });
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointer.current || pointer.current.id !== event.pointerId || exiting) return;
    const finalDrag = { x: event.clientX - pointer.current.x, y: event.clientY - pointer.current.y };
    pointer.current = null;
    if (Math.hypot(finalDrag.x, finalDrag.y) >= 42) dismiss(finalDrag);
    else setDrag({ x: 0, y: 0 });
  };

  const dragDistance = Math.min(1, Math.hypot(drag.x, drag.y) / 180);
  return (
    <div
      role={item.kind === 'error' ? 'alert' : 'status'}
      aria-live={item.kind === 'error' ? 'assertive' : 'polite'}
      tabIndex={0}
      data-kind={item.kind}
      data-dragging={pointer.current !== null}
      data-exiting={exiting}
      className={styles.toast}
      style={{
        transform: `translate3d(${drag.x}px, ${drag.y}px, 0) scale(${1 - dragDistance * .035})`,
        opacity: exiting ? 0 : 1 - dragDistance * .42,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onTransitionEnd={(event) => {
        if (exiting && event.propertyName === 'transform') onDismiss(item.id);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Delete' || event.key === 'Backspace') dismiss({ x: 0, y: -1 });
      }}
    >
      <span className={styles.icon} aria-hidden>{item.kind === 'success' ? '✓' : item.kind === 'error' ? '!' : 'i'}</span>
      <span className={styles.message}>{item.text}</span>
      <span className={styles.swipeHint} aria-hidden />
    </div>
  );
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);

  useEffect(() => {
    pushFn = ({ text, kind }) => {
      const id = Date.now() + Math.random();
      setItems((current) => [...current.slice(-2), { id, text, kind }]);
    };
    return () => { pushFn = null; };
  }, []);

  return (
    <div className={styles.viewport} aria-label="Notifications">
      {items.map((item) => <ToastItem key={item.id} item={item} onDismiss={dismiss} />)}
    </div>
  );
}

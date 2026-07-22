'use client';
import { useCallback, useEffect, useRef } from 'react';
import { pushCanactPopupGesture } from './popupGuards';

type Options = {
  onClose: () => void;
  getScrollElement?: () => HTMLElement | null;
  enabled?: boolean;
  threshold?: number;
};

type GestureState = {
  active: boolean;
  dragging: boolean;
  closed: boolean;
  startX: number;
  startY: number;
  lastY: number;
  lastAt: number;
  deltaY: number;
  releaseGesture: (() => void) | null;
};

const EMPTY_GESTURE: GestureState = {
  active: false,
  dragging: false,
  closed: false,
  startX: 0,
  startY: 0,
  lastY: 0,
  lastAt: 0,
  deltaY: 0,
  releaseGesture: null,
};

export function useTopScrollSwipeDismiss({
  onClose,
  getScrollElement,
  enabled = true,
  threshold = 74,
}: Options) {
  const elementRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  const getScrollElementRef = useRef(getScrollElement);
  const enabledRef = useRef(enabled);
  const thresholdRef = useRef(threshold);
  const gestureRef = useRef<GestureState>({ ...EMPTY_GESTURE });

  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => { getScrollElementRef.current = getScrollElement; }, [getScrollElement]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { thresholdRef.current = threshold; }, [threshold]);

  const isScrollAtTop = useCallback(() => {
    const element = getScrollElementRef.current?.();
    return !element || element.scrollTop <= 1;
  }, []);

  const release = useCallback(() => {
    gestureRef.current.releaseGesture?.();
    gestureRef.current = { ...EMPTY_GESTURE };
  }, []);

  const clearInlineMotion = useCallback((element: HTMLElement) => {
    element.style.removeProperty('transition');
    element.style.removeProperty('transform');
    element.style.removeProperty('opacity');
    element.style.removeProperty('--canact-sheet-drag-progress');
  }, []);

  const settle = useCallback((dismiss: boolean) => {
    const element = elementRef.current;
    const gesture = gestureRef.current;
    if (!element || !gesture.dragging) {
      release();
      return;
    }
    gesture.active = false;
    element.style.transition = dismiss
      ? 'transform 220ms cubic-bezier(.32,.72,0,1), opacity 180ms ease-out'
      : 'transform 300ms cubic-bezier(.2,.9,.25,1.15)';
    // Preserve the exact finger position as the first animation frame, then
    // either continue off-screen or spring back to the sheet's resting place.
    requestAnimationFrame(() => {
      element.style.transform = dismiss ? 'translate3d(0, 105dvh, 0)' : 'translate3d(0, 0, 0)';
      if (dismiss) element.style.opacity = '0.96';
    });

    const finish = () => {
      element.removeEventListener('transitionend', finish);
      clearInlineMotion(element);
      release();
      if (dismiss) closeRef.current();
    };
    element.addEventListener('transitionend', finish, { once: true });
  }, [clearInlineMotion, release]);

  // Use native non-passive listeners for ALL touch events so preventDefault()
  // is honoured by the browser from touchstart onwards.
  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;

    // CSS hint: tell the browser we handle vertical pans ourselves
    el.style.touchAction = 'pan-y pinch-zoom';

    const handleTouchStart = (e: TouchEvent) => {
      if (!enabledRef.current || e.touches.length !== 1 || !isScrollAtTop()) {
        release();
        return;
      }
      e.stopPropagation();
      const touch = e.touches[0];
      gestureRef.current = {
        active: true,
        dragging: false,
        closed: false,
        startX: touch.clientX,
        startY: touch.clientY,
        lastY: touch.clientY,
        lastAt: performance.now(),
        deltaY: 0,
        releaseGesture: pushCanactPopupGesture(),
      };
    };

    const handleTouchMove = (e: TouchEvent) => {
      const gesture = gestureRef.current;
      if (!gesture.active || gesture.closed || e.touches.length !== 1) return;
      e.stopPropagation();
      if (!isScrollAtTop()) {
        release();
        return;
      }
      const touch = e.touches[0];
      const deltaY = touch.clientY - gesture.startY;
      const deltaX = touch.clientX - gesture.startX;
      const mostlyVertical = deltaY > Math.abs(deltaX) * 1.2;
      if (deltaY <= 0 || !mostlyVertical) return;
      if (!isScrollAtTop()) return;
      e.preventDefault();
      gesture.dragging = true;
      gesture.deltaY = deltaY;
      gesture.lastY = touch.clientY;
      gesture.lastAt = performance.now();
      el.style.transition = 'none';
      el.style.transform = `translate3d(0, ${deltaY}px, 0)`;
      el.style.setProperty('--canact-sheet-drag-progress', String(Math.min(1, deltaY / Math.max(1, window.innerHeight))));
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const gesture = gestureRef.current;
      if (!gesture.active) return;
      const endY = e.changedTouches[0]?.clientY ?? gesture.lastY;
      const elapsed = Math.max(1, performance.now() - gesture.lastAt);
      const velocity = Math.max(0, endY - gesture.lastY) / elapsed;
      const dismiss = gesture.dragging
        && (gesture.deltaY >= thresholdRef.current || (gesture.deltaY > 24 && velocity > 0.55));
      settle(dismiss);
    };

    const handleTouchCancel = () => settle(false);

    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd);
    el.addEventListener('touchcancel', handleTouchCancel);

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchCancel);
      clearInlineMotion(el);
      el.style.touchAction = '';
    };
  }, [clearInlineMotion, enabled, isScrollAtTop, release, settle]);

  return {
    ref: elementRef,
  };
}

'use client';
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
  closed: boolean;
  startX: number;
  startY: number;
  releaseGesture: (() => void) | null;
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
  const gestureRef = useRef<GestureState>({ active: false, closed: false, startX: 0, startY: 0, releaseGesture: null });

  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => { getScrollElementRef.current = getScrollElement; }, [getScrollElement]);

  const isScrollAtTop = useCallback(() => {
    const element = getScrollElementRef.current?.();
    return !element || element.scrollTop <= 1;
  }, []);

  const reset = useCallback(() => {
    gestureRef.current.releaseGesture?.();
    gestureRef.current = { active: false, closed: false, startX: 0, startY: 0, releaseGesture: null };
  }, []);

  // Attach touchmove as non-passive so preventDefault works
  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;

    const handleTouchMove = (e: TouchEvent) => {
      const gesture = gestureRef.current;
      if (!gesture.active || gesture.closed || e.touches.length !== 1) return;
      e.stopPropagation();
      if (!isScrollAtTop()) {
        reset();
        return;
      }
      const touch = e.touches[0];
      const deltaY = touch.clientY - gesture.startY;
      const deltaX = touch.clientX - gesture.startX;
      const mostlyVertical = deltaY > Math.abs(deltaX) * 1.2;
      if (deltaY > 8 && mostlyVertical) e.preventDefault();
      if (deltaY >= threshold && mostlyVertical) {
        gestureRef.current.closed = true;
        closeRef.current();
      }
    };

    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', handleTouchMove);
  }, [isScrollAtTop, reset, threshold]);

  // Attach touchend / touchcancel so we can reset
  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;
    const end = () => reset();
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [reset]);

  const onTouchStart = useCallback((e: React.TouchEvent<HTMLElement>) => {
    if (!enabled || e.touches.length !== 1 || !isScrollAtTop()) {
      reset();
      return;
    }
    e.stopPropagation();
    const touch = e.touches[0];
    gestureRef.current = { active: true, closed: false, startX: touch.clientX, startY: touch.clientY, releaseGesture: pushCanactPopupGesture() };
  }, [enabled, isScrollAtTop, reset]);

  return {
    ref: elementRef,
    onTouchStart,
  };
}
'use client';
import { useCallback, useEffect, useRef, type TouchEvent } from 'react';
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

  const onTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    if (!enabled || event.touches.length !== 1 || !isScrollAtTop()) {
      reset();
      return;
    }
    event.stopPropagation();
    const touch = event.touches[0];
    gestureRef.current = { active: true, closed: false, startX: touch.clientX, startY: touch.clientY, releaseGesture: pushCanactPopupGesture() };
  }, [enabled, isScrollAtTop, reset]);

  const onTouchMove = useCallback((event: TouchEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture.active || gesture.closed || event.touches.length !== 1) return;
    event.stopPropagation();
    if (!isScrollAtTop()) {
      reset();
      return;
    }
    const touch = event.touches[0];
    const deltaY = touch.clientY - gesture.startY;
    const deltaX = touch.clientX - gesture.startX;
    const mostlyVertical = deltaY > Math.abs(deltaX) * 1.2;
    if (deltaY > 8 && mostlyVertical) event.preventDefault();
    if (deltaY >= threshold && mostlyVertical) {
      gestureRef.current.closed = true;
      closeRef.current();
    }
  }, [isScrollAtTop, reset, threshold]);

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd: reset,
    onTouchCancel: reset,
  };
}
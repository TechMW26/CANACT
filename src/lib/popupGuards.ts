'use client';

let openPopupCount = 0;
let activePopupGestureCount = 0;
let sheetZoomCount = 0;

function updatePopupFlags() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('canact-popup-open', openPopupCount > 0);
  root.classList.toggle('canact-popup-gesture-active', activePopupGestureCount > 0);
  root.dataset.canactPopupOpen = openPopupCount > 0 ? 'true' : 'false';
  root.dataset.canactPopupGestureActive = activePopupGestureCount > 0 ? 'true' : 'false';
}

export function pushCanactPopupOpen() {
  if (typeof document === 'undefined') return () => {};
  let released = false;
  openPopupCount += 1;
  updatePopupFlags();
  return () => {
    if (released) return;
    released = true;
    openPopupCount = Math.max(0, openPopupCount - 1);
    updatePopupFlags();
  };
}

export function pushCanactPopupGesture() {
  if (typeof document === 'undefined') return () => {};
  let released = false;
  activePopupGestureCount += 1;
  updatePopupFlags();
  return () => {
    if (released) return;
    released = true;
    activePopupGestureCount = Math.max(0, activePopupGestureCount - 1);
    updatePopupFlags();
  };
}

export function isCanactPopupInteractionActive(target?: EventTarget | null) {
  if (typeof document === 'undefined') return false;
  const root = document.documentElement;
  if (root.dataset.canactPopupOpen === 'true' || root.dataset.canactPopupGestureActive === 'true') return true;
  if (target instanceof Element && target.closest('[data-canact-popup]')) return true;
  return false;
}

export function pushCanactSheetZoom(shell: HTMLElement | null) {
  if (!shell) return () => {};
  let released = false;
  sheetZoomCount += 1;
  shell.classList.add('canact-sheet-zoom-out');
  return () => {
    if (released) return;
    released = true;
    sheetZoomCount = Math.max(0, sheetZoomCount - 1);
    if (sheetZoomCount === 0) shell.classList.remove('canact-sheet-zoom-out');
  };
}

export function clearCanactSheetZoom(shell: HTMLElement | null) {
  if (!shell) return;
  sheetZoomCount = 0;
  shell.classList.remove('canact-sheet-zoom-out');
}
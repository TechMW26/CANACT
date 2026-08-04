'use client';

let openPopupCount = 0;
let activePopupGestureCount = 0;
const sheetZoomStates = new Map<symbol, { shell: HTMLElement; progress: number; immediate: boolean }>();

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

function applyCanactSheetZoom(shell: HTMLElement) {
  const states = [...sheetZoomStates.values()].filter((state) => state.shell === shell);
  const progress = states.reduce((maximum, state) => Math.max(maximum, state.progress), 0);
  const immediate = states.some((state) => state.immediate);
  shell.style.setProperty('--canact-sheet-open-progress', String(progress));
  shell.style.setProperty('--canact-sheet-scale', String(1 - progress * 0.1));
  shell.style.setProperty('--canact-sheet-radius', `${progress * 24}px`);
  shell.classList.toggle('canact-sheet-zoom-out', states.length > 0);
  shell.classList.toggle('canact-sheet-zoom-dragging', immediate);
}

export function pushCanactSheetZoom(shell: HTMLElement | null) {
  if (!shell) return { setProgress: (_progress: number, _immediate?: boolean) => {}, release: () => {} };
  const id = Symbol('canact-sheet-zoom');
  let released = false;
  sheetZoomStates.set(id, { shell, progress: 0, immediate: false });
  applyCanactSheetZoom(shell);
  return {
    setProgress(progress: number, immediate = false) {
      if (released) return;
      const state = sheetZoomStates.get(id);
      if (!state) return;
      state.progress = Math.max(0, Math.min(1, progress));
      state.immediate = immediate;
      applyCanactSheetZoom(shell);
    },
    release() {
      if (released) return;
      released = true;
      sheetZoomStates.delete(id);
      applyCanactSheetZoom(shell);
      if (![...sheetZoomStates.values()].some((state) => state.shell === shell)) {
        shell.style.removeProperty('--canact-sheet-open-progress');
        shell.style.removeProperty('--canact-sheet-scale');
        shell.style.removeProperty('--canact-sheet-radius');
      }
    },
  };
}

export function clearCanactSheetZoom(shell: HTMLElement | null) {
  if (!shell) return;
  for (const [id, state] of sheetZoomStates) if (state.shell === shell) sheetZoomStates.delete(id);
  shell.classList.remove('canact-sheet-zoom-out');
  shell.classList.remove('canact-sheet-zoom-dragging');
  shell.style.removeProperty('--canact-sheet-open-progress');
  shell.style.removeProperty('--canact-sheet-scale');
  shell.style.removeProperty('--canact-sheet-radius');
}

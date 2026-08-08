'use client';

let lockCount = 0;
let restoreState: {
  scrollY: number;
  fixedBody: boolean;
  bodyOverflow: string;
  bodyPosition: string;
  bodyTop: string;
  bodyLeft: string;
  bodyRight: string;
  bodyWidth: string;
  bodyOverscrollBehavior: string;
  htmlOverflow: string;
  htmlOverscrollBehavior: string;
} | null = null;

function restorePageScroll() {
  if (!restoreState) return;
  const body = document.body;
  const html = document.documentElement;
  const state = restoreState;
  restoreState = null;
  body.style.overflow = state.bodyOverflow;
  body.style.position = state.bodyPosition;
  body.style.top = state.bodyTop;
  body.style.left = state.bodyLeft;
  body.style.right = state.bodyRight;
  body.style.width = state.bodyWidth;
  body.style.overscrollBehavior = state.bodyOverscrollBehavior;
  html.style.overflow = state.htmlOverflow;
  html.style.overscrollBehavior = state.htmlOverscrollBehavior;
  const isIOSWebKit = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (state.fixedBody && Math.abs(window.scrollY - state.scrollY) > 1) window.scrollTo(0, state.scrollY);
  if (isIOSWebKit) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (lockCount === 0) window.scrollTo(0, state.scrollY);
    }));
  }
}

export function lockPageScroll() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  lockCount += 1;
  if (lockCount === 1) {
    const body = document.body;
    const html = document.documentElement;
    const keepFixedFooterStable = !!document.querySelector('[data-canact-bottom-nav]');
    const scrollY = window.scrollY || html.scrollTop || 0;
    restoreState = {
      scrollY,
      fixedBody: !keepFixedFooterStable,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
      bodyOverscrollBehavior: body.style.overscrollBehavior,
      htmlOverflow: html.style.overflow,
      htmlOverscrollBehavior: html.style.overscrollBehavior,
    };
    html.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    if (!keepFixedFooterStable) {
      body.style.position = 'fixed';
      body.style.top = `-${scrollY}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.width = '100%';
    }
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount !== 0 || !restoreState) return;
    restorePageScroll();
  };
}

/** Recover from an interrupted/unmounted overlay that failed to release its
 * scroll token. Called before new pointer gestures and after app resumes. */
export function recoverOrphanedPageScroll() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const root = document.documentElement;
  const hasActiveSurface = Array.from(document.querySelectorAll<HTMLElement>(
    '[data-canact-popup="true"], [data-canact-scroll-lock="true"]',
  )).some((surface) => {
    if (surface.hidden || surface.dataset.expanded === 'false') return false;
    if (surface.matches('[data-canact-popup="true"]') && surface.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(surface);
    if (style.display === 'none' || style.visibility === 'hidden' || Number.parseFloat(style.opacity || '1') <= 0.01) return false;
    const rect = surface.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  if (hasActiveSurface || root.dataset.canactFullscreenPage === 'true' || root.hasAttribute('data-canact-fullscreen-page')) return;
  const body = document.body;
  const shell = document.getElementById('canact-app-shell');
  const content = document.getElementById('canact-app-content');
  const appearsLocked = lockCount > 0
    || body.style.overflow === 'hidden'
    || root.style.overflow === 'hidden'
    || body.style.position === 'fixed'
    || shell?.style.overflow === 'hidden'
    || !!shell?.style.height
    || content?.classList.contains('canact-sheet-zoom-out');
  if (!appearsLocked) return;
  lockCount = 0;
  if (restoreState) restorePageScroll();
  if (body.style.overflow === 'hidden') body.style.removeProperty('overflow');
  if (root.style.overflow === 'hidden') root.style.removeProperty('overflow');
  if (body.style.overscrollBehavior === 'none') body.style.removeProperty('overscroll-behavior');
  if (root.style.overscrollBehavior === 'none') root.style.removeProperty('overscroll-behavior');
  if (body.style.position === 'fixed') {
    body.style.removeProperty('position');
    body.style.removeProperty('top');
    body.style.removeProperty('left');
    body.style.removeProperty('right');
    body.style.removeProperty('width');
  }
  if (shell?.style.overflow === 'hidden') shell.style.removeProperty('overflow');
  if (shell?.style.height) shell.style.removeProperty('height');
  if (content?.classList.contains('canact-sheet-zoom-out')) {
    content.classList.remove('canact-sheet-zoom-out', 'canact-sheet-zoom-dragging');
    content.style.removeProperty('--canact-sheet-open-progress');
    content.style.removeProperty('--canact-sheet-scale');
    content.style.removeProperty('--canact-sheet-radius');
  }
  root.classList.remove('canact-popup-open', 'canact-popup-gesture-active');
  delete root.dataset.canactPopupOpen;
  delete root.dataset.canactPopupGestureActive;
}

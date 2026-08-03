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
    const body = document.body;
    const html = document.documentElement;
    const scrollY = restoreState.scrollY;
    const fixedBody = restoreState.fixedBody;
    body.style.overflow = restoreState.bodyOverflow;
    body.style.position = restoreState.bodyPosition;
    body.style.top = restoreState.bodyTop;
    body.style.left = restoreState.bodyLeft;
    body.style.right = restoreState.bodyRight;
    body.style.width = restoreState.bodyWidth;
    body.style.overscrollBehavior = restoreState.bodyOverscrollBehavior;
    html.style.overflow = restoreState.htmlOverflow;
    html.style.overscrollBehavior = restoreState.htmlOverscrollBehavior;
    restoreState = null;
    if (fixedBody && Math.abs(window.scrollY - scrollY) > 1) window.scrollTo(0, scrollY);
  };
}

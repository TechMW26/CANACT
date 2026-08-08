'use client';

import { useEffect } from 'react';

const POPUP_SELECTOR = '[data-canact-popup="true"], .canact-popup-backdrop';
const POPUP_STATUS_BAR_COLOR = '#a2a9a7';

export function PopupStatusBarSync() {
  useEffect(() => {
    const root = document.documentElement;
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const originalTheme = theme?.content ?? '#ffffff';
    const originalBackground = root.style.backgroundColor;
    let frame = 0;

    const popupIsVisible = () => Array.from(document.querySelectorAll<HTMLElement>(POPUP_SELECTOR)).some((element) => {
      if (element.dataset.expanded === 'false') return false;
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && Number.parseFloat(style.opacity || '1') > 0.01;
    });

    const sync = () => {
      frame = 0;
      const open = popupIsVisible();
      root.toggleAttribute('data-canact-popup-statusbar', open);
      root.style.backgroundColor = open ? POPUP_STATUS_BAR_COLOR : originalBackground;
      if (theme) theme.content = open ? POPUP_STATUS_BAR_COLOR : originalTheme;
    };

    const scheduleSync = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };

    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'data-expanded', 'data-canact-popup'],
    });
    sync();

    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      root.removeAttribute('data-canact-popup-statusbar');
      root.style.backgroundColor = originalBackground;
      if (theme) theme.content = originalTheme;
    };
  }, []);

  return null;
}

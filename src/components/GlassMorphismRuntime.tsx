'use client';

import { useEffect } from 'react';

const GLASS_SELECTOR = '[data-liquid-glass]:not([data-liquid-glass="none"])';

function syncGlassVariables(element: HTMLElement) {
  const isSwitcher = element.dataset.liquidGlass === 'switcher';
  const tint = (element.dataset.liquidTint || '250,248,242')
    .split(',')
    .map((channel) => String(Math.max(0, Math.min(255, Number(channel) || 0))))
    .join(' ');
  const requestedOpacity = Number(element.dataset.liquidTintOpacity);
  const minimumOpacity = isSwitcher ? 0.14 : 0.18;
  const opacity = Number.isFinite(requestedOpacity)
    ? Math.max(minimumOpacity, Math.min(0.36, requestedOpacity))
    : minimumOpacity;

  element.style.setProperty('--canact-glass-tint-rgb', tint);
  element.style.setProperty('--canact-glass-tint-opacity', String(opacity));
  element.style.setProperty('--canact-glass-blur', isSwitcher ? '14px' : '20px');
  if (!element.classList.contains('canact-glass-positioned') && getComputedStyle(element).position === 'static') {
    element.classList.add('canact-glass-positioned');
  }
}

export function GlassMorphismRuntime() {
  useEffect(() => {
    const syncAll = () => {
      document.querySelectorAll<HTMLElement>('[data-liquid-glass]').forEach((element) => {
        if (element.matches(GLASS_SELECTOR)) syncGlassVariables(element);
        else element.classList.remove('canact-glass-positioned');
      });
    };

    syncAll();
    const observer = new MutationObserver(syncAll);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-liquid-glass', 'data-liquid-tint', 'data-liquid-tint-opacity'],
    });

    return () => observer.disconnect();
  }, []);

  return null;
}

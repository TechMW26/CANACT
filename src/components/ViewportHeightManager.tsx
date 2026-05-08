'use client';

import { useEffect } from 'react';

const VIEWPORT_HEIGHT_VAR = '--canact-viewport-height';
const VIEWPORT_UNIT_VAR = '--canact-vh';

function getViewportHeight() {
  if (typeof window === 'undefined') return 0;
  const visualHeight = window.visualViewport?.height ?? 0;
  const innerHeight = window.innerHeight || 0;
  const clientHeight = document.documentElement.clientHeight || 0;
  return Math.max(1, Math.round(visualHeight || innerHeight || clientHeight));
}

export default function ViewportHeightManager() {
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    let orientationTimer = 0;
    let lastHeight = 0;

    const applyViewportHeight = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const height = getViewportHeight();
        if (!height || Math.abs(height - lastHeight) < 1) return;
        lastHeight = height;
        root.style.setProperty(VIEWPORT_HEIGHT_VAR, `${height}px`);
        root.style.setProperty(VIEWPORT_UNIT_VAR, `${height * 0.01}px`);
      });
    };

    const handleViewportChange = () => {
      applyViewportHeight();
      if (orientationTimer) window.clearTimeout(orientationTimer);
      orientationTimer = window.setTimeout(applyViewportHeight, 240);
    };

    applyViewportHeight();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('orientationchange', handleViewportChange);
    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('scroll', handleViewportChange);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (orientationTimer) window.clearTimeout(orientationTimer);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('orientationchange', handleViewportChange);
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('scroll', handleViewportChange);
    };
  }, []);

  return null;
}
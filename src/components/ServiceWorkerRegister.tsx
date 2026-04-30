'use client';

import { useEffect } from 'react';

/** Registers /sw.js with a build-version query string so each deploy
 *  installs a fresh worker and silently activates it. The first time
 *  the controller changes (i.e. the new SW takes over) we reload the
 *  page exactly once so the user picks up the new UI without seeing
 *  a stale shell. Local development (npm run dev) bypasses registration
 *  so HMR keeps working untouched. */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    const buildId = process.env.NEXT_PUBLIC_BUILD_ID || 'dev';
    const swUrl = `/sw.js?v=${encodeURIComponent(buildId)}`;

    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded) return;
      reloaded = true;
      // The new SW has taken over \u2014 reload once so the page is served
      // by the new shell. sessionStorage guards against reload loops if
      // the browser fires controllerchange more than once.
      try {
        if (sessionStorage.getItem('canact_sw_reloaded') !== buildId) {
          sessionStorage.setItem('canact_sw_reloaded', buildId);
          window.location.reload();
        }
      } catch {
        window.location.reload();
      }
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    navigator.serviceWorker
      .register(swUrl, { scope: '/' })
      .then((reg) => {
        // If a new SW is already waiting, ask it to activate immediately.
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              // A new version finished installing alongside an existing
              // controller \u2014 tell it to activate so controllerchange fires.
              installing.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch(() => {
        // SW registration failure is non-fatal; the app still works.
      });

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  return null;
}

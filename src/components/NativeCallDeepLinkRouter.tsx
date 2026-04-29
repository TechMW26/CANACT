'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { setCallPreDecision } from './IncomingCallRinger';

function isNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap: any = (window as any).Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === 'function') return cap.isNativePlatform();
  return cap.platform === 'android' || cap.platform === 'ios';
}

/**
 * Listens for canact://call/<id>?action=answer|decline deep links emitted by
 * the native full-screen FCM call notification (CanactCallMessagingService).
 *
 * On receipt we navigate the WebView to /call/<id>?action=… so the existing
 * IncomingCallRinger / call screen picks up where it would have if the user
 * had been actively viewing the app.
 */
export default function NativeCallDeepLinkRouter() {
  const router = useRouter();
  useEffect(() => {
    if (!isNative()) return;
    let handle: { remove: () => Promise<void> } | null = null;
    let cancelled = false;

    // Single dispatcher for both cold-start launch URLs and warm appUrlOpen
    // events \u2014 the cold-start path is the one that fixes "I tap Answer on
    // the notification but the app still asks me to confirm again". When
    // the app is killed, tapping the CallStyle Answer action launches
    // MainActivity with the canact://call/<id>?action=answer intent, but
    // the @capacitor/app appUrlOpen listener doesn't get a chance to
    // register before the WebView starts loading \u2014 so the URL was being
    // dropped on the floor. Polling getLaunchUrl() at startup catches it.
    const handleUrl = (url: string | null | undefined) => {
      if (!url) return;

      if (url.startsWith('canact://open')) {
        try {
          const u = new URL(url);
          const to = u.searchParams.get('to');
          if (to && to.startsWith('/')) router.push(to);
        } catch { /* noop */ }
        return;
      }

      if (!url.startsWith('canact://call/')) return;
      try {
        const u = new URL(url);
        const callId = u.pathname.replace(/^\/+/, '').split('/')[0] || u.host;
        const action = u.searchParams.get('action');
        if (callId && (action === 'answer' || action === 'decline')) {
          setCallPreDecision(callId, action);
        }
      } catch { /* noop */ }
      try {
        if (typeof window !== 'undefined' && window.location.pathname === '/welcome') {
          router.replace('/');
        }
      } catch { /* noop */ }
    };

    (async () => {
      const { App } = await import('@capacitor/app');
      if (cancelled) return;

      // 1) Cold-start: the URL the OS used to launch us.
      try {
        const launch = await App.getLaunchUrl();
        if (launch?.url) handleUrl(launch.url);
      } catch { /* noop */ }

      // 2) Warm-start: subsequent appUrlOpen events while the app is alive.
      handle = await App.addListener('appUrlOpen', (data: { url: string }) => {
        handleUrl(data?.url);
      });
    })().catch(() => { /* noop */ });

    return () => {
      cancelled = true;
      handle?.remove().catch(() => { /* noop */ });
    };
  }, [router]);

  return null;
}

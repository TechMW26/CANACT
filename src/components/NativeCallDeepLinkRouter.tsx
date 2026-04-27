'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { setCallStatus, clearIncoming } from '@/lib/services/calls';
import { getFirebaseAuth } from '@/lib/firebase';

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
    (async () => {
      const { App } = await import('@capacitor/app');
      if (cancelled) return;
      handle = await App.addListener('appUrlOpen', (data: { url: string }) => {
        if (!data?.url || !data.url.startsWith('canact://call/')) return;
        // Parse out the callId + action so we can honour an explicit decline
        // from the notification action button (the OS dismisses the
        // notification automatically when the action button fires; we only
        // need to update RTDB so the caller learns the call was declined).
        try {
          const u = new URL(data.url);
          const callId = u.pathname.replace(/^\/+/, '').split('/')[0] || u.host;
          const action = u.searchParams.get('action');
          if (action === 'decline' && callId) {
            setCallStatus(callId, 'rejected').catch(() => { /* noop */ });
            const auth = getFirebaseAuth();
            const me = auth.currentUser;
            if (me) clearIncoming(me.uid, callId).catch(() => { /* noop */ });
          }
        } catch { /* noop */ }
        // Bringing the app to foreground is enough — IncomingCallRinger is
        // globally mounted and re-subscribes to incomingCalls/{uid} the
        // moment the WebView reconnects, so the ringer pops on its own. We
        // simply route to '/' if the user wasn't already inside the app.
        try {
          if (typeof window !== 'undefined' && window.location.pathname === '/welcome') {
            router.replace('/');
          }
        } catch { /* noop */ }
      });
    })().catch(() => { /* noop */ });
    return () => {
      cancelled = true;
      handle?.remove().catch(() => { /* noop */ });
    };
  }, [router]);

  return null;
}

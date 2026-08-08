'use client';

import { useEffect, useState } from 'react';
import { Bell, Share2, X } from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { getFirebaseAuth } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import {
  enableWebPush,
  isIosDevice,
  pushSupported,
  webPushErrorMessage,
  webPushInstallRequired,
} from '@/lib/services/push';
import { toast } from './Toaster';

type PromptKind = 'install' | 'enable' | null;
const DISMISSED_KEY = 'canact:ios-web-push-prompt-dismissed';

/** Refresh an existing browser push subscription after sign-in/app launch.
 * Permission is never requested here: iOS requires that prompt to originate
 * from the user's tap on the Settings/onboarding button. */
export default function WebPushBootstrapper() {
  const { user } = useAuth();
  const [prompt, setPrompt] = useState<PromptKind>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (cap?.isNativePlatform?.() || !pushSupported() || Notification.permission !== 'granted') return;

    return onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (user) void enableWebPush(user.uid);
    });
  }, []);

  useEffect(() => {
    if (!user || !isIosDevice()) return;
    const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (cap?.isNativePlatform?.() || sessionStorage.getItem(DISMISSED_KEY) === '1') return;
    if ('Notification' in window && Notification.permission !== 'default') return;

    const timer = window.setTimeout(() => {
      if (webPushInstallRequired()) setPrompt('install');
      else if (pushSupported()) setPrompt('enable');
    }, 900);
    return () => window.clearTimeout(timer);
  }, [user?.uid]);

  const dismiss = () => {
    sessionStorage.setItem(DISMISSED_KEY, '1');
    setPrompt(null);
  };

  const enable = async () => {
    if (!user || busy) return;
    setBusy(true);
    try {
      const result = await enableWebPush(user.uid);
      if (!result.ok) throw new Error(webPushErrorMessage(result.reason));
      setPrompt(null);
      toast('Notifications enabled', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : webPushErrorMessage(), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!prompt) return null;
  const install = prompt === 'install';

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="ios-push-title"
      className="fixed inset-x-4 bottom-[max(18px,env(safe-area-inset-bottom))] z-[2147483050] mx-auto max-w-md rounded-[28px] border border-brand/15 bg-[#FAF8F2] p-4 text-ink shadow-[0_20px_70px_rgba(6,49,39,.24)]"
    >
      <button type="button" onClick={dismiss} aria-label="Dismiss notification setup" className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-brand hover:bg-brand/10">
        <X size={18} aria-hidden="true" />
      </button>
      <div className="flex gap-3 pr-9">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand text-white">
          {install ? <Share2 size={22} aria-hidden="true" /> : <Bell size={22} aria-hidden="true" />}
        </div>
        <div>
          <h2 id="ios-push-title" className="text-base font-extrabold">
            {install ? 'Get notifications on iPhone' : 'Never miss a Canact alert'}
          </h2>
          <p className="mt-1 text-sm leading-5 text-ink/70">
            {install
              ? 'In your browser, tap Share, choose Add to Home Screen, then open Canact from its new icon.'
              : 'Enable notifications for messages, Help updates, calls and nearby activity—even when Canact is in the background.'}
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-end gap-3">
        <button type="button" onClick={dismiss} className="h-11 px-3 text-sm font-bold text-brand">Not now</button>
        {install ? (
          <button type="button" onClick={dismiss} className="h-11 rounded-full bg-brand px-5 text-sm font-bold text-white">Got it</button>
        ) : (
          <button type="button" onClick={() => void enable()} disabled={busy} className="h-11 rounded-full bg-brand px-5 text-sm font-bold text-white disabled:opacity-60">
            {busy ? 'Enabling…' : 'Enable notifications'}
          </button>
        )}
      </div>
    </section>
  );
}

'use client';

/**
 * Browser-fallback Google Sign-In helper.
 *
 * When the native Google Sign-In SDK inside the Capacitor APK fails or hangs
 * (e.g. missing google-services.json, SHA-1 not registered, Play Services
 * unavailable), the app opens this page in the system browser via
 * `@capacitor/browser`. Here we run a real `signInWithPopup` (allowed by
 * Google in a real browser), then redirect back to the app via a custom
 * scheme deep link so the APK can pick up the id token and exchange it for
 * a Firebase credential without the user having to do anything else.
 *
 * Query params:
 *  - return: the deep link to redirect to on success or failure. Defaults to
 *            `canact://auth-callback`.
 */

import { useEffect, useRef, useState } from 'react';
import { signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider } from 'firebase/auth';
import { getFirebaseAuth, getGoogleProvider } from '@/lib/firebase';

function defaultReturn() {
  return 'canact://auth-callback';
}

function buildReturnUrl(base: string, params: Record<string, string>) {
  const hash = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${base}#${hash}`;
}

export default function NativeAuthPage() {
  const [status, setStatus] = useState<'starting' | 'redirecting' | 'error'>('starting');
  const [message, setMessage] = useState('Opening Google sign-in…');
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const url = new URL(window.location.href);
    const ret = url.searchParams.get('return') || defaultReturn();

    async function run() {
      const auth = getFirebaseAuth();
      const provider = getGoogleProvider();

      // First check if we are returning from a redirect flow.
      try {
        const redirectResult = await getRedirectResult(auth);
        if (redirectResult?.user) {
          const cred = GoogleAuthProvider.credentialFromResult(redirectResult);
          const idToken = cred?.idToken;
          if (idToken) {
            setStatus('redirecting');
            setMessage('Returning to Canact…');
            window.location.replace(buildReturnUrl(ret, { idToken }));
            return;
          }
        }
      } catch {
        // ignore — fall through to popup
      }

      try {
        const result = await signInWithPopup(auth, provider);
        const cred = GoogleAuthProvider.credentialFromResult(result);
        const idToken = cred?.idToken;
        if (!idToken) throw new Error('No id token returned from Google.');
        setStatus('redirecting');
        setMessage('Returning to Canact…');
        window.location.replace(buildReturnUrl(ret, { idToken }));
      } catch (err: any) {
        const code = err?.code ?? '';
        // Mobile browsers often block popups → fall back to redirect, which
        // returns to this same page; the getRedirectResult branch above will
        // then forward the token to the app.
        if (
          code === 'auth/popup-blocked' ||
          code === 'auth/popup-closed-by-user' ||
          code === 'auth/cancelled-popup-request' ||
          code === 'auth/operation-not-supported-in-this-environment'
        ) {
          try {
            await signInWithRedirect(auth, provider);
            return;
          } catch (e: any) {
            setStatus('error');
            setMessage(e?.message ?? 'Sign-in failed.');
            return;
          }
        }
        // Any other failure → bounce back to the app with an error param so the
        // app can dismiss the loader and surface a message.
        setStatus('error');
        setMessage(err?.message ?? 'Sign-in failed.');
        try {
          window.location.replace(buildReturnUrl(ret, { error: err?.message ?? 'sign-in-failed' }));
        } catch { /* noop */ }
      }
    }

    run();
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-[#FFF8F8] text-[#0A0A0A]">
      <div className="text-center max-w-sm">
        <div className="mx-auto mb-4 h-10 w-10 rounded-full border-2 border-[#FF4D4F] border-t-transparent animate-spin" aria-hidden />
        <h1 className="text-lg font-semibold mb-2">
          {status === 'redirecting' ? 'Almost done' : status === 'error' ? 'Sign-in failed' : 'Continue with Google'}
        </h1>
        <p className="text-sm text-neutral-600">{message}</p>
        {status === 'error' && (
          <p className="text-xs text-neutral-500 mt-4">You can close this tab and try again.</p>
        )}
      </div>
    </main>
  );
}

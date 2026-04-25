'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { BrandMark } from '@/components/Brand';
import { useAuth } from '@/lib/auth';
import { toast } from '@/components/Toaster';

function GoogleGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.3 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.3-.1-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.1l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.3 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.1z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.6 2.3-7.2 2.3-5.3 0-9.7-3.4-11.3-8L6 32.7C9.4 38.6 16.1 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.7 2.1-2.1 3.9-3.9 5.2l6.2 5.2C41.2 35 44 30 44 24c0-1.3-.1-2.3-.4-3.5z"/>
    </svg>
  );
}

export default function WelcomePage() {
  const router = useRouter();
  const { user, profile, loading, signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    if (profile && profile.profileComplete === false) router.replace('/onboard');
    else if (profile) router.replace('/feed');
  }, [user, profile, loading, router]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <div className="flex justify-center mb-4"><BrandMark size={96} /></div>
        <h1 className="text-4xl font-extrabold text-brand">Canact</h1>
        <p className="mt-2 text-muted">Community-first. Location-aware. Real people nearby.</p>

        <div className="mt-10">
          <Button
            full
            size="lg"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await signInWithGoogle();
              } catch (err: any) {
                toast(err?.message ?? 'Could not sign in', 'error');
              } finally {
                setBusy(false);
              }
            }}
            className="!bg-white !text-ink ring-1 ring-line hover:!bg-brand-light"
          >
            <span className="inline-flex items-center justify-center gap-3">
              <GoogleGlyph />
              <span className="font-semibold">Continue with Google</span>
            </span>
          </Button>
          <p className="mt-4 text-xs text-ink/55">
            By continuing you agree to our terms and privacy policy.
          </p>
        </div>
      </div>
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Splash } from '@/components/Splash';

/** Profile-fetch fallback: if RTDB never returns within this window, treat the
 * user as new and route to /onboard so they don't sit on a splash forever. */
const PROFILE_TIMEOUT_MS = 7000;

export default function Home() {
  const router = useRouter();
  const { user, profile, loading } = useAuth();
  const [profileTimedOut, setProfileTimedOut] = useState(false);

  // Start the timeout once we have a user but no profile yet.
  useEffect(() => {
    if (!user || profile) { setProfileTimedOut(false); return; }
    const id = setTimeout(() => setProfileTimedOut(true), PROFILE_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [user, profile]);

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace('/welcome'); return; }
    // Wait for profile snapshot before deciding onboard vs feed — avoids
    // bouncing existing users to /onboard during the brief RTDB latency window.
    if (!profile && !profileTimedOut) return;
    if (!profile || profile.profileComplete === false) router.replace('/onboard');
    else router.replace('/feed');
  }, [user, profile, loading, profileTimedOut, router]);

  return <Splash message={user ? 'Signing you in…' : 'Loading…'} />;
}

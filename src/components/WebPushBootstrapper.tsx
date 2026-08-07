'use client';

import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { getFirebaseAuth } from '@/lib/firebase';
import { enableWebPush, pushSupported } from '@/lib/services/push';

/** Refresh an existing browser push subscription after sign-in/app launch.
 * Permission is never requested here: iOS requires that prompt to originate
 * from the user's tap on the Settings/onboarding button. */
export default function WebPushBootstrapper() {
  useEffect(() => {
    const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (cap?.isNativePlatform?.() || !pushSupported() || Notification.permission !== 'granted') return;

    return onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (user) void enableWebPush(user.uid);
    });
  }, []);

  return null;
}

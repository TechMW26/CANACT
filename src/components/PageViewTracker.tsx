'use client';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { recordPageView } from '@/lib/services/heatzones';

/**
 * Tracks page views for the Heatzones admin analytics.
 * On every route change, records: current page, previous page, and user UID.
 */
export function PageViewTracker() {
  const pathname = usePathname();
  const { user } = useAuth();
  const prevRef = useRef<string>('');
  const lastRecordedRef = useRef<string>('');
  const userRef = useRef<string>('');

  useEffect(() => {
    if (!user?.uid) return;
    if (userRef.current !== user.uid) {
      userRef.current = user.uid;
      prevRef.current = '';
      lastRecordedRef.current = '';
    }
    const current = pathname || '/';
    const recordKey = `${user.uid}:${current}`;
    if (lastRecordedRef.current === recordKey) return;
    const prev = prevRef.current || 'Direct';
    recordPageView(current, prev, user.uid);
    prevRef.current = current;
    lastRecordedRef.current = recordKey;
  }, [pathname, user?.uid]);

  return null;
}

'use client';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { pageLabel, recordFeatureClick, recordPageView } from '@/lib/services/heatzones';

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

  useEffect(() => {
    if (!user?.uid) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-heat-feature],a,button,[role="button"]')
        : null;
      if (!target) return;

      let featureId = target.dataset.heatFeature?.trim() || '';
      if (!featureId && target instanceof HTMLAnchorElement) {
        try {
          const url = new URL(target.href, window.location.href);
          if (url.origin === window.location.origin) featureId = `navigate_${pageLabel(url.pathname)}`;
        } catch {}
      }
      if (!featureId) {
        featureId = target.getAttribute('aria-label')
          || target.getAttribute('title')
          || target.textContent?.trim().replace(/\s+/g, ' ')
          || '';
      }
      featureId = featureId.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 64);
      if (featureId) void recordFeatureClick(pageLabel(pathname || '/'), featureId, user.uid);
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [pathname, user?.uid]);

  return null;
}

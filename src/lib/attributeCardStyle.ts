'use client';

import { useSyncExternalStore } from 'react';
import { onValue, ref } from 'firebase/database';
import { db } from '@/lib/firebase';

export type AttributeCardStyle = 'html' | 'image';

export type AttributeCardStyleConfig = {
  style: AttributeCardStyle;
  updatedAt?: number;
  updatedBy?: string | null;
};

export const ATTRIBUTE_CARD_STYLE_CONFIG_PATH = 'config/styling/attributeCards';
export const DEFAULT_ATTRIBUTE_CARD_STYLE: AttributeCardStyle = 'html';

let currentStyle: AttributeCardStyle = DEFAULT_ATTRIBUTE_CARD_STYLE;
let listening = false;
const subscribers = new Set<() => void>();

export function normalizeAttributeCardStyle(value: unknown): AttributeCardStyle {
  const candidate = typeof value === 'string' ? value : (value as { style?: unknown } | null)?.style;
  return candidate === 'image' ? 'image' : DEFAULT_ATTRIBUTE_CARD_STYLE;
}

function publish(next: AttributeCardStyle) {
  if (next === currentStyle) return;
  currentStyle = next;
  try { window.localStorage.setItem('canact:attribute-card-style', next); } catch {}
  subscribers.forEach((notify) => notify());
}

function ensureRealtimeListener() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  try {
    publish(normalizeAttributeCardStyle(window.localStorage.getItem('canact:attribute-card-style')));
  } catch {}
  onValue(ref(db, ATTRIBUTE_CARD_STYLE_CONFIG_PATH), (snapshot) => {
    publish(normalizeAttributeCardStyle(snapshot.val()));
  });
}

function subscribe(notify: () => void) {
  subscribers.add(notify);
  ensureRealtimeListener();
  return () => subscribers.delete(notify);
}

export function useAttributeCardStyle(): AttributeCardStyle {
  return useSyncExternalStore(subscribe, () => currentStyle, () => DEFAULT_ATTRIBUTE_CARD_STYLE);
}

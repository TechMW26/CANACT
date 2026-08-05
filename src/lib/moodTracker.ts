import type { MoodKind, MoodState } from './types';

export type { MoodKind, MoodState } from './types';

export type MoodDefinition = {
  id: MoodKind;
  label: string;
  state: MoodState;
  accent: string;
  soft: string;
};

export type MoodEntry = {
  id: string;
  mood: MoodKind;
  state: MoodState;
  intensity: number;
  contexts: string[];
  note: string;
  completedActions: string[];
  createdAt: number;
};

export const MOODS: MoodDefinition[] = [
  { id: 'joyful', label: 'Joyful', state: 'balanced', accent: '#925116', soft: '#fff0d5' },
  { id: 'calm', label: 'Calm', state: 'balanced', accent: '#1f6b55', soft: '#deefea' },
  { id: 'grateful', label: 'Grateful', state: 'balanced', accent: '#784452', soft: '#f7e4e8' },
  { id: 'tired', label: 'Tired', state: 'low', accent: '#4d5d8b', soft: '#e7eaf6' },
  { id: 'drained', label: 'Drained', state: 'low', accent: '#54476b', soft: '#ebe6f1' },
  { id: 'numb', label: 'Numb', state: 'low', accent: '#4d5d5a', soft: '#e7ecea' },
  { id: 'sad', label: 'Sad', state: 'vulnerable', accent: '#365f86', soft: '#e3edf6' },
  { id: 'anxious', label: 'Anxious', state: 'vulnerable', accent: '#874a33', soft: '#f8e5dc' },
  { id: 'lonely', label: 'Lonely', state: 'vulnerable', accent: '#65475b', soft: '#f0e5ec' },
];

export function getMoodDefinition(kind?: MoodKind | null) {
  return MOODS.find((mood) => mood.id === kind) ?? null;
}

const STORAGE_VERSION = 1;
const KEY_STORAGE = 'canact:mood-device-key:v1';

function dataStorageKey(uid: string) {
  return `canact:mood:${uid}:v${STORAGE_VERSION}`;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function moodCryptoKey() {
  let encoded = window.localStorage.getItem(KEY_STORAGE);
  if (!encoded) {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    encoded = bytesToBase64(raw);
    window.localStorage.setItem(KEY_STORAGE, encoded);
  }
  return crypto.subtle.importKey('raw', base64ToBytes(encoded), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function loadMoodEntries(uid: string): Promise<MoodEntry[]> {
  if (typeof window === 'undefined' || !uid) return [];
  const stored = window.localStorage.getItem(dataStorageKey(uid));
  if (!stored) return [];
  try {
    const payload = JSON.parse(stored) as { iv: string; data: string };
    const key = await moodCryptoKey();
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(payload.iv) }, key, base64ToBytes(payload.data));
    const parsed = JSON.parse(new TextDecoder().decode(decrypted));
    return Array.isArray(parsed) ? parsed.filter((entry): entry is MoodEntry => !!entry?.id && typeof entry.createdAt === 'number') : [];
  } catch {
    return [];
  }
}

async function persistMoodEntries(uid: string, entries: MoodEntry[]) {
  const key = await moodCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(entries.slice(0, 400)));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  window.localStorage.setItem(dataStorageKey(uid), JSON.stringify({ iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(encrypted)) }));
}

export async function saveMoodEntry(uid: string, entry: MoodEntry) {
  const entries = await loadMoodEntries(uid);
  const next = [entry, ...entries.filter((item) => item.id !== entry.id)].sort((left, right) => right.createdAt - left.createdAt);
  await persistMoodEntries(uid, next);
  return next;
}

export function clearMoodEntries(uid: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(dataStorageKey(uid));
}

function localDayKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function moodStreak(entries: MoodEntry[]) {
  const days = new Set(entries.map((entry) => localDayKey(entry.createdAt)));
  const cursor = new Date();
  if (!days.has(localDayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(localDayKey(cursor.getTime()))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

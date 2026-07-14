'use client';

import { get, onValue, ref } from 'firebase/database';
import { db, getFirebaseAuth } from '@/lib/firebase';
import { haversineMeters } from '@/lib/utils';
import {
  LIFETIME_CARD_KINDS,
  type GiftCandidate,
  type GiftCandidateCategory,
  type LifetimeCardGift,
  type LifetimeCardKind,
  type LifetimeCardSlot,
  type UserProfile,
} from '@/lib/types';

export function defaultLifetimeInventory(): Record<LifetimeCardKind, LifetimeCardSlot> {
  return Object.fromEntries(LIFETIME_CARD_KINDS.map((kind) => [kind, { kind, status: 'available' }])) as Record<LifetimeCardKind, LifetimeCardSlot>;
}

export function listenLifetimeInventory(uid: string, callback: (inventory: Record<LifetimeCardKind, LifetimeCardSlot>) => void) {
  return onValue(ref(db, `lifetimeCards/inventory/${uid}`), (snapshot) => {
    callback({ ...defaultLifetimeInventory(), ...(snapshot.val() ?? {}) });
  });
}

export function listenReceivedLifetimeCards(uid: string, callback: (cards: LifetimeCardGift[]) => void) {
  return onValue(ref(db, `lifetimeCards/received/${uid}`), (snapshot) => {
    const cards: LifetimeCardGift[] = [];
    snapshot.forEach((child) => { if (child.val()) cards.push(child.val() as LifetimeCardGift); });
    cards.sort((a, b) => b.sentAt - a.sentAt);
    callback(cards);
  });
}

export async function sendLifetimeCard(toUid: string, kind: LifetimeCardKind, customText?: string) {
  const currentUser = getFirebaseAuth().currentUser;
  if (!currentUser) throw new Error('Sign in to send a card');
  const idToken = await currentUser.getIdToken();
  const response = await fetch('/api/lifetime-cards/gift', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ toUid, kind, customText }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const messages: Record<string, string> = {
      'card-already-sent': 'This lifetime card has already been given.',
      'custom-text-required': 'Add your message before sending this card.',
      'cannot-gift-yourself': 'Choose someone else for this card.',
      'card-service-unavailable': 'Lifetime cards are temporarily unavailable.',
    };
    throw new Error(messages[result.reason] || 'Could not send the lifetime card');
  }
  return result as { ok: true; giftId: string };
}

type LocatedProfile = UserProfile & { lastLocation?: { lat?: number; lng?: number; at?: number } };

export async function loadGiftCandidates(me: LocatedProfile): Promise<GiftCandidate[]> {
  const [usersSnap, friendsSnap, favouritesSnap, contactsSnap, threadIndexSnap, ratedSnap] = await Promise.all([
    get(ref(db, 'users')),
    get(ref(db, `friends/${me.uid}`)),
    get(ref(db, `favourites/${me.uid}`)),
    get(ref(db, `contacts/${me.uid}`)),
    get(ref(db, `userThreads/${me.uid}`)),
    get(ref(db, `ratedPairs/${me.uid}`)),
  ]);

  const friends = keySet(friendsSnap.val());
  const favourites = keySet(favouritesSnap.val());
  const contacts = keySet(contactsSnap.val());
  const interacted = keySet(ratedSnap.val());
  const threadIds = Object.keys(threadIndexSnap.val() ?? {});
  await Promise.all(threadIds.map(async (threadId) => {
    const thread = (await get(ref(db, `chatThreads/${threadId}`))).val() as { members?: Record<string, boolean> } | null;
    Object.keys(thread?.members ?? {}).forEach((uid) => { if (uid !== me.uid) interacted.add(uid); });
  }));

  const myLocation = validLocation(me.lastLocation);
  const candidates: GiftCandidate[] = [];
  usersSnap.forEach((child) => {
    const profile = child.val() as LocatedProfile;
    if (!profile || profile.uid === me.uid || profile.underground) return;
    const categories: GiftCandidateCategory[] = [];
    if (interacted.has(profile.uid)) categories.push('interacted');
    if (friends.has(profile.uid)) categories.push('friends');
    if (favourites.has(profile.uid)) categories.push('favourites');
    if (contacts.has(profile.uid)) categories.push('contacts');
    const theirLocation = validLocation(profile.lastLocation);
    if (myLocation && theirLocation && haversineMeters(myLocation, theirLocation) <= 25_000) categories.push('nearby');
    if (!categories.length) return;
    candidates.push({ uid: profile.uid, name: profile.fullName || 'Canact user', photoURL: profile.photoURL, city: profile.city, categories });
  });
  return candidates.sort((a, b) => b.categories.length - a.categories.length || a.name.localeCompare(b.name));
}

function keySet(value: unknown) {
  return new Set(Object.keys((value && typeof value === 'object' ? value : {}) as Record<string, unknown>));
}

function validLocation(value?: { lat?: number; lng?: number; at?: number } | null) {
  if (!value || !Number.isFinite(value.lat) || !Number.isFinite(value.lng)) return null;
  return { lat: Number(value.lat), lng: Number(value.lng) };
}

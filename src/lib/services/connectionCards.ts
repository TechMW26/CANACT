'use client';

import { onValue, ref } from 'firebase/database';
import { db, getFirebaseAuth } from '@/lib/firebase';
import type { CardKey, ConnectionCardGift } from '@/lib/types';

export function listenReceivedConnectionCards(uid: string, callback: (cards: ConnectionCardGift[]) => void) {
  return onValue(ref(db, `connectionCards/received/${uid}`), (snapshot) => {
    const cards: ConnectionCardGift[] = [];
    snapshot.forEach((child) => {
      const value = child.val() as ConnectionCardGift | null;
      if (value) cards.push(value);
    });
    cards.sort((a, b) => b.sentAt - a.sentAt);
    callback(cards);
  });
}

export async function sendConnectionCard(toUid: string, kind: CardKey) {
  const currentUser = getFirebaseAuth().currentUser;
  if (!currentUser) throw new Error('Sign in to send a connection card');
  const idToken = await currentUser.getIdToken();
  const response = await fetch('/api/connection-cards/gift', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ toUid, kind }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const messages: Record<string, string> = {
      'card-already-sent': 'You already gave this connection card to that person.',
      'cannot-gift-yourself': 'Choose someone else for this card.',
      'card-service-unavailable': 'Connection cards are temporarily unavailable.',
    };
    throw new Error(messages[result.reason] || 'Could not send the connection card');
  }
  return result as { ok: true; giftId: string };
}

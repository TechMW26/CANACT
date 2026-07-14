import { NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { getFirebaseAdminApp } from '@/lib/server/firebaseAdmin';
import { LIFETIME_CARD_KINDS, LIFETIME_CARD_LABELS, type LifetimeCardKind } from '@/lib/types';

export const runtime = 'nodejs';

function defaultInventory() {
  return Object.fromEntries(LIFETIME_CARD_KINDS.map((kind) => [kind, { kind, status: 'available' }])) as Record<LifetimeCardKind, { kind: LifetimeCardKind; status: 'available' | 'sent'; sentAt?: number; recipientUid?: string; recipientName?: string }>;
}

export async function POST(request: Request) {
  const app = getFirebaseAdminApp();
  if (!app) return NextResponse.json({ ok: false, reason: 'card-service-unavailable' }, { status: 503 });

  const authorization = request.headers.get('authorization') || '';
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!idToken) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  let fromUid: string;
  try {
    fromUid = (await getAuth(app).verifyIdToken(idToken)).uid;
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid-token' }, { status: 401 });
  }

  let body: { toUid?: string; kind?: LifetimeCardKind; customText?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, reason: 'bad-json' }, { status: 400 });
  }
  const toUid = String(body.toUid || '').trim();
  const kind = body.kind;
  const customText = String(body.customText || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  if (!toUid || !kind || !LIFETIME_CARD_KINDS.includes(kind)) {
    return NextResponse.json({ ok: false, reason: 'missing-fields' }, { status: 400 });
  }
  if (toUid === fromUid) return NextResponse.json({ ok: false, reason: 'cannot-gift-yourself' }, { status: 400 });
  if (kind === 'custom' && !customText) return NextResponse.json({ ok: false, reason: 'custom-text-required' }, { status: 400 });
  if (kind === 'custom' && customText.split(/\s+/).length > 24) return NextResponse.json({ ok: false, reason: 'custom-text-too-long' }, { status: 400 });

  const database = getDatabase(app);
  const [fromSnap, toSnap] = await Promise.all([
    database.ref(`users/${fromUid}`).get(),
    database.ref(`users/${toUid}`).get(),
  ]);
  if (!fromSnap.exists() || !toSnap.exists()) return NextResponse.json({ ok: false, reason: 'user-not-found' }, { status: 404 });
  const from = fromSnap.val() as { fullName?: string; photoURL?: string };
  const to = toSnap.val() as { fullName?: string };
  const fromName = String(from.fullName || 'Someone');
  const toName = String(to.fullName || 'Canact user');
  const sentAt = Date.now();
  const giftId = `${fromUid}__${kind}`;
  let abortReason = 'card-already-sent';

  const result = await database.ref('lifetimeCards').transaction((current: any) => {
    const state = current ?? {};
    state.inventory = state.inventory ?? {};
    state.received = state.received ?? {};
    state.sent = state.sent ?? {};
    const inventory = state.inventory[fromUid] ?? defaultInventory();
    const slot = inventory[kind];
    if (!slot || slot.status === 'sent' || state.sent[fromUid]?.[giftId]) return;

    inventory[kind] = { kind, status: 'sent', sentAt, recipientUid: toUid, recipientName: toName };
    state.inventory[fromUid] = inventory;
    const gift = {
      id: giftId,
      kind,
      fromUid,
      fromName,
      ...(from.photoURL ? { fromPhoto: from.photoURL } : {}),
      toUid,
      toName,
      ...(kind === 'custom' ? { customText } : {}),
      sentAt,
    };
    state.received[toUid] = state.received[toUid] ?? {};
    state.received[toUid][giftId] = gift;
    state.sent[fromUid] = state.sent[fromUid] ?? {};
    state.sent[fromUid][giftId] = gift;
    abortReason = '';
    return state;
  }, undefined, false);

  if (!result.committed) return NextResponse.json({ ok: false, reason: abortReason }, { status: 409 });

  const notification = database.ref(`notifications/${toUid}`).push();
  await notification.set({
    id: notification.key,
    kind: 'gift',
    title: `${fromName} gave you ${LIFETIME_CARD_LABELS[kind]}`,
    body: kind === 'custom' ? customText : 'A permanent lifetime recognition card was added to your profile.',
    data: { fromUid, giftId },
    read: false,
    createdAt: sentAt,
  });

  return NextResponse.json({ ok: true, giftId });
}

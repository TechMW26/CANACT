import { NextResponse } from 'next/server';
import { getFirebaseAdminApp, readAdminRtdb, runUserRtdbTransaction, verifyUserRequest, writeUserRtdb } from '@/lib/server/firebaseAdmin';
import { LIFETIME_CARD_KINDS, LIFETIME_CARD_LABELS, type LifetimeCardKind } from '@/lib/types';

export const runtime = 'nodejs';

function defaultInventory() {
  return Object.fromEntries(LIFETIME_CARD_KINDS.map((kind) => [kind, { kind, status: 'available' }])) as Record<LifetimeCardKind, { kind: LifetimeCardKind; status: 'available' | 'sent'; sentAt?: number; recipientUid?: string; recipientName?: string }>;
}

export async function POST(request: Request) {
  const app = getFirebaseAdminApp();
  const verified = await verifyUserRequest(request, app);
  if (!verified) {
    return NextResponse.json({ ok: false, reason: 'invalid-token' }, { status: 401 });
  }
  const { uid: fromUid, idToken } = verified;

  let body: { toUid?: string; kind?: LifetimeCardKind; customText?: string; sourceGiftId?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, reason: 'bad-json' }, { status: 400 });
  }
  const toUid = String(body.toUid || '').trim();
  const kind = body.kind;
  const customText = String(body.customText || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  const sourceGiftId = String(body.sourceGiftId || '').trim();
  if (!toUid || !kind || !LIFETIME_CARD_KINDS.includes(kind)) {
    return NextResponse.json({ ok: false, reason: 'missing-fields' }, { status: 400 });
  }
  if (toUid === fromUid) return NextResponse.json({ ok: false, reason: 'cannot-gift-yourself' }, { status: 400 });
  if (sourceGiftId && (sourceGiftId.length > 300 || /[.#$/\[\]]/.test(sourceGiftId))) return NextResponse.json({ ok: false, reason: 'invalid-card-id' }, { status: 400 });
  if (!sourceGiftId && kind === 'custom' && !customText) return NextResponse.json({ ok: false, reason: 'custom-text-required' }, { status: 400 });
  if (!sourceGiftId && kind === 'custom' && customText.split(/\s+/).length > 24) return NextResponse.json({ ok: false, reason: 'custom-text-too-long' }, { status: 400 });

  const [from, to] = await Promise.all([
    readAdminRtdb<{ fullName?: string; photoURL?: string }>(`users/${fromUid}`, app, idToken),
    readAdminRtdb<{ fullName?: string }>(`users/${toUid}`, app, idToken),
  ]);
  if (!from || !to) return NextResponse.json({ ok: false, reason: 'user-not-found' }, { status: 404 });
  const fromName = String(from.fullName || 'Someone');
  const toName = String(to.fullName || 'Canact user');
  const sentAt = Date.now();
  const giftId = sourceGiftId || `${fromUid}__${kind}`;
  let deliveredCustomText = customText;
  let abortReason = sourceGiftId ? 'card-not-owned' : 'card-already-sent';

  const result = await runUserRtdbTransaction<any>('lifetimeCards', app, idToken, (current) => {
    const state = current ?? {};
    state.inventory = state.inventory ?? {};
    state.received = state.received ?? {};
    state.sent = state.sent ?? {};
    const ownedGift = sourceGiftId ? state.received[fromUid]?.[sourceGiftId] : null;
    if (sourceGiftId && (!ownedGift || ownedGift.kind !== kind)) return;

    if (!sourceGiftId) {
      const inventory = state.inventory[fromUid] ?? defaultInventory();
      const slot = inventory[kind];
      if (!slot || slot.status === 'sent' || state.sent[fromUid]?.[giftId]) return;
      inventory[kind] = { kind, status: 'sent', sentAt, recipientUid: toUid, recipientName: toName };
      state.inventory[fromUid] = inventory;
    } else {
      deliveredCustomText = String(ownedGift.customText || '');
      delete state.received[fromUid][sourceGiftId];
    }

    const gift = {
      ...(ownedGift ?? {}),
      id: giftId,
      kind,
      fromUid,
      fromName,
      ...(from.photoURL ? { fromPhoto: from.photoURL } : {}),
      toUid,
      toName,
      ...(kind === 'custom' && deliveredCustomText ? { customText: deliveredCustomText } : {}),
      sentAt,
      transferCount: Number(ownedGift?.transferCount || 0) + (sourceGiftId ? 1 : 0),
    };
    state.received[toUid] = state.received[toUid] ?? {};
    state.received[toUid][giftId] = gift;
    state.sent[fromUid] = state.sent[fromUid] ?? {};
    state.sent[fromUid][sourceGiftId ? `${giftId}__${sentAt}` : giftId] = gift;
    abortReason = '';
    return state;
  });

  if (!result.committed) return NextResponse.json({ ok: false, reason: abortReason }, { status: 409 });

  try {
    const notificationId = crypto.randomUUID();
    await writeUserRtdb(`notifications/${toUid}/${notificationId}`, {
      id: notificationId,
      kind: 'gift',
      title: `${fromName} gave you ${LIFETIME_CARD_LABELS[kind]}`,
      body: kind === 'custom' ? deliveredCustomText : 'A lifetime recognition card was added to your profile.',
      data: { fromUid, giftId },
      read: false,
      createdAt: sentAt,
    }, app, idToken);
  } catch {
    // Ownership transfer has already committed. Notification delivery must
    // never make the client treat a successful permanent transfer as failed.
  }

  return NextResponse.json({ ok: true, giftId });
}

import { NextResponse } from 'next/server';
import { getFirebaseAdminApp, readAdminRtdb, runUserRtdbTransaction, verifyUserRequest, writeUserRtdb } from '@/lib/server/firebaseAdmin';
import { CARD_KEYS, CARD_LABELS, type CardKey } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const app = getFirebaseAdminApp();
  const verified = await verifyUserRequest(request, app);
  if (!verified) {
    return NextResponse.json({ ok: false, reason: 'invalid-token' }, { status: 401 });
  }
  const { uid: fromUid, idToken } = verified;

  let body: { toUid?: string; kind?: CardKey };
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, reason: 'bad-json' }, { status: 400 });
  }
  const toUid = String(body.toUid || '').trim();
  const kind = body.kind;
  if (!toUid || !kind || !CARD_KEYS.includes(kind)) {
    return NextResponse.json({ ok: false, reason: 'missing-fields' }, { status: 400 });
  }
  if (toUid === fromUid) return NextResponse.json({ ok: false, reason: 'cannot-gift-yourself' }, { status: 400 });

  const [from, to] = await Promise.all([
    readAdminRtdb<{ fullName?: string; photoURL?: string }>(`users/${fromUid}`, app, idToken),
    readAdminRtdb<{ fullName?: string }>(`users/${toUid}`, app, idToken),
  ]);
  if (!from || !to) return NextResponse.json({ ok: false, reason: 'user-not-found' }, { status: 404 });
  const fromName = String(from.fullName || 'Someone');
  const toName = String(to.fullName || 'Canact user');
  const sentAt = Date.now();
  const giftId = `${fromUid}__${toUid}__${kind}`;

  const result = await runUserRtdbTransaction<any>('connectionCards', app, idToken, (current) => {
    const state = current ?? {};
    state.received = state.received ?? {};
    state.sent = state.sent ?? {};
    if (state.sent[fromUid]?.[toUid]?.[kind]) return;

    const gift = {
      id: giftId,
      kind,
      fromUid,
      fromName,
      ...(from.photoURL ? { fromPhoto: from.photoURL } : {}),
      toUid,
      toName,
      sentAt,
    };
    state.received[toUid] = state.received[toUid] ?? {};
    state.received[toUid][giftId] = gift;
    state.sent[fromUid] = state.sent[fromUid] ?? {};
    state.sent[fromUid][toUid] = state.sent[fromUid][toUid] ?? {};
    state.sent[fromUid][toUid][kind] = { giftId, sentAt };
    return state;
  });

  if (!result.committed) return NextResponse.json({ ok: false, reason: 'card-already-sent' }, { status: 409 });

  try {
    const notificationId = crypto.randomUUID();
    await writeUserRtdb(`notifications/${toUid}/${notificationId}`, {
      id: notificationId,
      kind: 'gift',
      title: `${fromName} gave you ${CARD_LABELS[kind]}`,
      body: 'A connection card was added to your profile.',
      data: { fromUid, giftId, family: 'connection' },
      read: false,
      createdAt: sentAt,
    }, app, idToken);
  } catch {
    // The card has already committed; notification failure is non-fatal.
  }

  return NextResponse.json({ ok: true, giftId });
}

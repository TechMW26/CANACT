import { onValue, push, ref, set, update, get, remove, query, orderByChild, runTransaction } from 'firebase/database';
import { db } from '../firebase';
import { HelpRequest, HelpStatus, HelpType } from '../types';
import { pushNotification } from './notifications';
import { sendPush, notifyHelpVicinity } from './sendPush';
import { startOrGetThread, threadIdFor, sendChatMessage } from './chat';
import { recordOnboardingSignal } from './onboarding';

/** Recursively drop undefined fields — Firebase RTDB rejects them. */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as any;
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value as any)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out;
  }
  return value;
}

async function bumpStat(uid: string, key: string, delta = 1) {
  await runTransaction(ref(db, `users/${uid}/helpStats/${key}`), (n: number | null) => Math.max(0, (n ?? 0) + delta));
}

/** Bump a per-type resolved/confirmed stat based on help type. */
async function bumpTypedStat(uid: string, kind: 'resolved' | 'confirmed', helpType: HelpType, delta = 1) {
  const key = `${helpType}${kind.charAt(0).toUpperCase() + kind.slice(1)}` as string;
  await bumpStat(uid, key, delta);
}

export async function createHelp(input: Omit<HelpRequest, 'id' | 'createdAt' | 'status'>) {
  if (!input.text || !input.text.trim()) {
    throw new Error('Please describe what you need.');
  }
  if (input.type === 'red' && (input.authorRating ?? 0) < 3.5) {
    throw new Error('Red Help requires a rating of 3.5 or higher. Build trust first with Orange or Yellow help.');
  }
  const node = push(ref(db, 'help'));
  const help: HelpRequest = stripUndefined({
    ...input,
    id: node.key!,
    createdAt: Date.now(),
    status: 'open',
  });
  try {
    await set(node, help);
    await set(ref(db, `userHelps/${input.uid}/${help.id}`), help.createdAt);
    await bumpStat(input.uid, 'asked', 1);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg.includes('PERMISSION_DENIED')) throw new Error('Not allowed to post help here. Try signing in again.');
    if (msg.toLowerCase().includes('network')) throw new Error('Network issue — check your connection and try again.');
    throw new Error(`Could not send help request: ${msg}`);
  }
  // Fan out a vicinity-aware push so anyone inside the chosen radius gets a
  // shoulder-tap. Audience controls whether we include public users, only
  // favourites or only friends. Best-effort, never blocks the create flow.
  if (typeof help.lat === 'number' && typeof help.lng === 'number' && help.vicinityMeters > 0) {
    const typeLabel = help.type === 'red' ? 'Red' : help.type === 'orange' ? 'Orange' : 'Yellow';
    notifyHelpVicinity({
      helpId: help.id,
      lat: help.lat,
      lng: help.lng,
      vicinityMeters: help.vicinityMeters,
      audience: help.audience,
      title: `${typeLabel} Help nearby · ${help.authorName}`,
      body: help.text.slice(0, 140),
      url: `/help/${help.id}`,
      tag: `help:${help.id}`,
    });
  }
  return help;
}

export function listenHelpFeed(cb: (items: HelpRequest[]) => void) {
  return onValue(query(ref(db, 'help'), orderByChild('createdAt')), (snap) => {
    const out: HelpRequest[] = [];
    snap.forEach((c) => {
      const v = c.val() as HelpRequest | null;
      if (v && v.status && v.status !== 'closed') out.push(v);
    });
    out.sort((a, b) => b.createdAt - a.createdAt);
    cb(out.slice(0, 100));
  });
}
export function listenHelp(id: string, cb: (h: HelpRequest | null) => void) {
  return onValue(ref(db, `help/${id}`), (s) => cb(s.val()));
}

export async function acceptHelp(id: string, helper: { uid: string; name: string; photoURL?: string }) {
  const helpSnap = await get(ref(db, `help/${id}`)); const help = helpSnap.val() as HelpRequest;
  await update(ref(db, `help/${id}/acceptedBy/${helper.uid}`), { name: helper.name, photoURL: helper.photoURL ?? null, at: Date.now() });
  await bumpStat(helper.uid, 'offered', 1);
  await recordOnboardingSignal(helper.uid, 'offer-help');
  await pushNotification(help.uid, { kind: 'help', title: `${helper.name} offered to help`, body: help.text.slice(0, 80), data: { helpId: id } });
  sendPush({
    toUid: help.uid,
    title: `${helper.name} offered to help`,
    body: help.text.slice(0, 120),
    url: `/help/${id}`,
    tag: `help:${id}`,
  });
}
export async function cancelHelpAccept(id: string, helperUid: string) {
  await remove(ref(db, `help/${id}/acceptedBy/${helperUid}`));
  await remove(ref(db, `help/${id}/confirmedHelpers/${helperUid}`));
  const acc = (await get(ref(db, `help/${id}/acceptedBy`))).val();
  if (!acc || Object.keys(acc).length === 0) await update(ref(db, `help/${id}`), { status: 'open' });
}

/**
 * Asker confirms a helper. Flips status to inProcess. For chat-channel helps,
 * auto-creates a chat thread so the helper can begin work immediately.
 */
export async function confirmHelper(
  id: string,
  helperUid: string,
  asker: { uid: string; name: string; photoURL?: string },
  helper: { name: string; photoURL?: string },
) {
  const help = (await get(ref(db, `help/${id}`))).val() as HelpRequest;
  if (!help) throw new Error('Help request not found.');
  if (help.uid !== asker.uid) throw new Error('Only the asker can confirm helpers.');

  await update(ref(db, `help/${id}/confirmedHelpers/${helperUid}`), { at: Date.now() });
  await update(ref(db, `help/${id}`), { status: 'inProcess' });
  await bumpStat(helperUid, 'confirmed', 1);
  await bumpTypedStat(helperUid, 'confirmed', help.type, 1);

  if (help.channel === 'chat') {
    const thread = await startOrGetThread(
      { uid: asker.uid, name: asker.name, photoURL: asker.photoURL },
      { uid: helperUid, name: helper.name, photoURL: helper.photoURL },
    );
    const tid = thread.id ?? threadIdFor(asker.uid, helperUid);
    await set(ref(db, `help/${id}/helpThreads/${helperUid}`), tid);
    try {
      await sendChatMessage(tid, asker.uid, helperUid, `📣 Help request: ${help.text}`);
    } catch { /* non-fatal */ }
  }

  await pushNotification(helperUid, {
    kind: 'help',
    title: `${asker.name} confirmed your help`,
    body: help.text.slice(0, 80),
    data: { helpId: id },
  });
  sendPush({
    toUid: helperUid,
    title: `${asker.name} confirmed your help`,
    body: help.text.slice(0, 120),
    url: `/help/${id}`,
    tag: `help:${id}:confirm`,
  });
}

export async function unconfirmHelper(id: string, helperUid: string) {
  const help = (await get(ref(db, `help/${id}`))).val() as HelpRequest;
  await remove(ref(db, `help/${id}/confirmedHelpers/${helperUid}`));
  await bumpStat(helperUid, 'confirmed', -1);
  if (help?.type) await bumpTypedStat(helperUid, 'confirmed', help.type, -1);
  const conf = (await get(ref(db, `help/${id}/confirmedHelpers`))).val();
  if (!conf || Object.keys(conf).length === 0) await update(ref(db, `help/${id}`), { status: 'open' });
}

export async function setHelpStatus(id: string, status: HelpStatus) { await update(ref(db, `help/${id}`), { status }); }

export async function requesterCloseHelp(id: string, outcome: 'yes' | 'no' | 'tried-good' | 'tried-bad') {
  const help = (await get(ref(db, `help/${id}`))).val() as HelpRequest;
  await update(ref(db, `help/${id}`), { status: 'closed', closedAt: Date.now(), closeOutcome: outcome });
  await bumpStat(help.uid, 'taken', 1);

  const targets = Object.keys(help.confirmedHelpers ?? help.acceptedBy ?? {});

  if (outcome === 'no') return;

  if (outcome === 'tried-good') {
    // Helper tried with genuine intent → +10 flat, no rating change
    for (const helperUid of targets) {
      await bumpStat(helperUid, 'triedGood', 1);
      await pushNotification(helperUid, {
        kind: 'help',
        title: 'Your help effort was appreciated',
        body: 'The seeker confirmed you tried with good intent. +10 CANACT score.',
        data: { helpId: id },
      });
      sendPush({
        toUid: helperUid,
        title: 'Your help effort was appreciated',
        body: 'The seeker confirmed you tried with good intent.',
        url: `/help/${id}`,
        tag: `help:${id}:tried-good`,
      }).catch(() => {});
    }
    return;
  }

  if (outcome === 'tried-bad') {
    // Helper tried with bad intent → −100 flat
    for (const helperUid of targets) {
      await bumpStat(helperUid, 'triedBad', 1);
      await pushNotification(helperUid, {
        kind: 'help',
        title: 'Negative outcome from a Help',
        body: 'The seeker reported bad intent. −100 CANACT score.',
        data: { helpId: id },
      });
      sendPush({
        toUid: helperUid,
        title: 'Negative outcome from a Help',
        body: 'The seeker reported bad intent.',
        url: `/help/${id}`,
        tag: `help:${id}:tried-bad`,
      }).catch(() => {});
    }
    return;
  }

  // outcome === 'yes' — fully resolved
  const delta = 0.05;
  for (const helperUid of targets) {
    await runTransaction(ref(db, `users/${helperUid}`), (u: any) => {
      if (!u) return u;
      u.rating = Math.min(5, (u.rating ?? 0) + delta);
      return u;
    });
    await bumpStat(helperUid, 'resolved', 1);
    await bumpStat(helperUid, 'yesOutcomes', 1);
    if (help.type) await bumpTypedStat(helperUid, 'resolved', help.type, 1);
    await pushNotification(helperUid, {
      kind: 'help',
      title: `+${delta.toFixed(2)} rating from a Help`,
      body: help.text.slice(0, 80),
      data: { helpId: id },
    });
    sendPush({
      toUid: helperUid,
      title: 'Help request resolved',
      body: 'Your help was marked as successful.',
      url: `/help/${id}`,
      tag: `help:${id}:resolved`,
    }).catch(() => {});
  }
}

export async function helperCloseHelp(id: string, helperUid: string) {
  await update(ref(db, `help/${id}/acceptedBy/${helperUid}`), { closedByHelper: true, helperClosedAt: Date.now() });
}

/**
 * Submit a 1-5 star rating for the other party of a closed help. Updates the
 * receiver's `rating`, `ratingCount` and like/dislike counts.
 */
export async function submitHelpRating(
  helpId: string,
  fromUid: string,
  toUid: string,
  stars: number,
  note?: string,
) {
  const key = `${fromUid}__${toUid}`;
  const existing = (await get(ref(db, `help/${helpId}/ratings/${key}`))).val();
  if (existing) return;
  const clean = Math.max(1, Math.min(5, Math.round(stars)));
  await set(ref(db, `help/${helpId}/ratings/${key}`), stripUndefined({
    fromUid, toUid, stars: clean, note: note?.trim() || undefined, at: Date.now(),
  }));
  await runTransaction(ref(db, `users/${toUid}`), (u: any) => {
    if (!u) return u;
    const prevCount = u.ratingCount ?? 0;
    const prevAvg = u.rating ?? 0;
    const nextCount = prevCount + 1;
    u.rating = Math.min(5, ((prevAvg * prevCount) + clean) / nextCount);
    u.ratingCount = nextCount;
    if (clean >= 4) u.likesCount = (u.likesCount ?? 0) + 1;
    else if (clean <= 2) u.dislikesCount = (u.dislikesCount ?? 0) + 1;
    return u;
  });
  await pushNotification(toUid, {
    kind: 'help',
    title: `New ${clean}★ rating from a Help`,
    body: note?.slice(0, 100) ?? '',
    data: { helpId },
  });
}

export async function getUserHelpStats(uid: string) {
  const snap = await get(ref(db, `users/${uid}/helpStats`));
  return (snap.val() ?? {}) as { offered?: number; confirmed?: number; resolved?: number; asked?: number; taken?: number };
}

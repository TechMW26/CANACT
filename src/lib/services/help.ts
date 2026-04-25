import { onValue, push, ref, set, update, get, remove, query, orderByChild, runTransaction } from 'firebase/database';
import { db } from '../firebase';
import { HelpRequest, HelpStatus } from '../types';
import { pushNotification } from './notifications';

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
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg.includes('PERMISSION_DENIED')) throw new Error('Not allowed to post help here. Try signing in again.');
    if (msg.toLowerCase().includes('network')) throw new Error('Network issue — check your connection and try again.');
    throw new Error(`Could not send help request: ${msg}`);
  }
  return help;
}

export function listenHelpFeed(cb: (items: HelpRequest[]) => void) {
  return onValue(query(ref(db, 'help'), orderByChild('createdAt')), (snap) => {
    const out: HelpRequest[] = []; snap.forEach((c) => { out.push(c.val()); });
    out.sort((a, b) => b.createdAt - a.createdAt); cb(out);
  });
}
export function listenHelp(id: string, cb: (h: HelpRequest | null) => void) {
  return onValue(ref(db, `help/${id}`), (s) => cb(s.val()));
}

export async function acceptHelp(id: string, helper: { uid: string; name: string; photoURL?: string }) {
  const helpSnap = await get(ref(db, `help/${id}`)); const help = helpSnap.val() as HelpRequest;
  await update(ref(db, `help/${id}/acceptedBy/${helper.uid}`), { name: helper.name, photoURL: helper.photoURL ?? null, at: Date.now() });
  await update(ref(db, `help/${id}`), { status: 'inProcess' });
  await pushNotification(help.uid, { kind: 'help', title: `${helper.name} accepted your help`, body: help.text.slice(0, 80), data: { helpId: id } });
}
export async function cancelHelpAccept(id: string, helperUid: string) {
  await remove(ref(db, `help/${id}/acceptedBy/${helperUid}`));
  const acc = (await get(ref(db, `help/${id}/acceptedBy`))).val();
  if (!acc || Object.keys(acc).length === 0) await update(ref(db, `help/${id}`), { status: 'open' });
}
export async function setHelpStatus(id: string, status: HelpStatus) { await update(ref(db, `help/${id}`), { status }); }

export async function requesterCloseHelp(id: string, outcome: 'yes' | 'no' | 'tried') {
  const help = (await get(ref(db, `help/${id}`))).val() as HelpRequest;
  await update(ref(db, `help/${id}`), { status: 'closed', closedAt: Date.now(), closeOutcome: outcome });
  if (outcome === 'no') return;
  const delta = outcome === 'yes' ? 0.05 : 0.02;
  for (const helperUid of Object.keys(help.acceptedBy ?? {})) {
    await runTransaction(ref(db, `users/${helperUid}`), (u: any) => {
      if (!u) return u;
      u.rating = Math.min(5, (u.rating ?? 0) + delta);
      return u;
    });
    await pushNotification(helperUid, { kind: 'help', title: `+${delta.toFixed(2)} rating from a Help`, body: help.text.slice(0, 80), data: { helpId: id } });
  }
}
export async function helperCloseHelp(id: string, helperUid: string) {
  await update(ref(db, `help/${id}/acceptedBy/${helperUid}`), { closedByHelper: true, helperClosedAt: Date.now() });
}

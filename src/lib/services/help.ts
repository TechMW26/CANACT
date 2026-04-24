import { onValue, push, ref, set, update, get, remove, query, orderByChild, runTransaction } from 'firebase/database';
import { db } from '../firebase';
import { HelpRequest, HelpStatus } from '../types';
import { pushNotification } from './notifications';

export async function createHelp(input: Omit<HelpRequest, 'id' | 'createdAt' | 'status'>) {
  if (input.type === 'red' && (input.authorRating ?? 0) < 3.5) {
    throw new Error('Red Help requires rating of 3.5 or higher.');
  }
  const node = push(ref(db, 'help'));
  const help: HelpRequest = { ...input, id: node.key!, createdAt: Date.now(), status: 'open' };
  await set(node, help);
  await set(ref(db, `userHelps/${input.uid}/${help.id}`), help.createdAt);
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

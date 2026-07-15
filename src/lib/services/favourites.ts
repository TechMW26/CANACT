import { onValue, push, ref, set, remove, get, update } from 'firebase/database';
import { db } from '../firebase';
import { ChatMessage } from '../types';
import { pushNotification } from './notifications';
import { sendPush } from './sendPush';
import { recordOnboardingSignal } from './onboarding';

export async function requestFollow(fromUid: string, fromName: string, toUid: string) {
  await set(ref(db, `followRequests/${toUid}/${fromUid}`), { fromUid, fromName, createdAt: Date.now() });
  await recordOnboardingSignal(fromUid, 'add-favourite');
  await pushNotification(toUid, { kind: 'follow', title: `${fromName} wants to add you to favourites`, data: { fromUid } });
  sendPush({
    toUid,
    title: `${fromName} wants to add you`,
    body: 'You have a new favourite request.',
    url: `/profile/${fromUid}`,
    tag: `follow:${fromUid}`,
  }).catch(() => {});
}
export async function acceptFollow(myUid: string, otherUid: string) {
  await set(ref(db, `favourites/${myUid}/${otherUid}`), Date.now());
  await set(ref(db, `favourites/${otherUid}/${myUid}`), Date.now());
  await remove(ref(db, `followRequests/${myUid}/${otherUid}`));
}
export async function rejectFollow(myUid: string, otherUid: string) {
  await remove(ref(db, `followRequests/${myUid}/${otherUid}`));
}
export async function blockUser(myUid: string, otherUid: string) {
  await set(ref(db, `blocks/${myUid}/${otherUid}`), Date.now());
  await remove(ref(db, `favourites/${myUid}/${otherUid}`));
  await remove(ref(db, `favourites/${otherUid}/${myUid}`));
}
export function listenFavourites(uid: string, cb: (uids: string[]) => void) {
  return onValue(ref(db, `favourites/${uid}`), (snap) => {
    const out: string[] = []; snap.forEach((c) => { out.push(c.key as string); }); cb(out);
  });
}
export function listenFollowRequests(uid: string, cb: (items: { fromUid: string; fromName: string; createdAt: number }[]) => void) {
  return onValue(ref(db, `followRequests/${uid}`), (snap) => {
    const out: any[] = []; snap.forEach((c) => { out.push(c.val()); }); cb(out);
  });
}
export async function isMutualFollow(a: string, b: string) {
  const x = (await get(ref(db, `favourites/${a}/${b}`))).val();
  const y = (await get(ref(db, `favourites/${b}/${a}`))).val();
  return !!(x && y);
}
function chatId(a: string, b: string) { return [a, b].sort().join('_'); }
export async function sendMessage(fromUid: string, toUid: string, text: string) {
  if (!(await isMutualFollow(fromUid, toUid))) throw new Error('You can only message mutual favourites.');
  const cid = chatId(fromUid, toUid);
  const node = push(ref(db, `messages/${cid}`));
  const m: ChatMessage = { id: node.key!, fromUid, toUid, text, createdAt: Date.now() };
  await set(node, m);
}
export function listenMessages(a: string, b: string, cb: (items: ChatMessage[]) => void) {
  return onValue(ref(db, `messages/${chatId(a, b)}`), (snap) => {
    const out: ChatMessage[] = []; snap.forEach((c) => { out.push(c.val()); });
    out.sort((x, y) => x.createdAt - y.createdAt); cb(out);
  });
}

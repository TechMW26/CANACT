import { onValue, push, ref, set, update } from 'firebase/database';
import { db } from '../firebase';
import { NotificationItem } from '../types';

export async function pushNotification(toUid: string, n: Omit<NotificationItem, 'id' | 'createdAt' | 'read'>) {
  const node = push(ref(db, `notifications/${toUid}`));
  const item: NotificationItem = { ...n, id: node.key!, createdAt: Date.now(), read: false };
  await set(node, item);
  return item;
}
export function listenNotifications(uid: string, cb: (items: NotificationItem[]) => void) {
  return onValue(ref(db, `notifications/${uid}`), (snap) => {
    const out: NotificationItem[] = []; snap.forEach((c) => { out.push(c.val()); });
    out.sort((a, b) => b.createdAt - a.createdAt); cb(out);
  });
}
export async function markRead(uid: string, id: string) { await update(ref(db, `notifications/${uid}/${id}`), { read: true }); }

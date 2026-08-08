import { onValue, ref, set, remove, get, update } from 'firebase/database';
import { db } from '../firebase';
import type { FriendEdge, FriendStatus } from '../types';

export async function sendFriendRequest(me: { uid: string; name: string; photoURL?: string }, other: { uid: string; name: string; photoURL?: string }) {
  const at = Date.now();
  await update(ref(db), {
    [`friendRequests/outgoing/${me.uid}/${other.uid}`]: { uid: other.uid, name: other.name, photoURL: other.photoURL ?? null, at },
    [`friendRequests/incoming/${other.uid}/${me.uid}`]: { uid: me.uid, name: me.name, photoURL: me.photoURL ?? null, at },
  });
}

export async function cancelFriendRequest(meUid: string, otherUid: string) {
  await update(ref(db), {
    [`friendRequests/outgoing/${meUid}/${otherUid}`]: null,
    [`friendRequests/incoming/${otherUid}/${meUid}`]: null,
  });
}

export async function acceptFriendRequest(meUid: string, me: { name: string; photoURL?: string }, otherUid: string, other: { name: string; photoURL?: string }) {
  const at = Date.now();
  await update(ref(db), {
    [`friendRequests/outgoing/${otherUid}/${meUid}`]: null,
    [`friendRequests/incoming/${meUid}/${otherUid}`]: null,
    [`friends/${meUid}/${otherUid}`]: { uid: otherUid, name: other.name, photoURL: other.photoURL ?? null, at },
    [`friends/${otherUid}/${meUid}`]: { uid: meUid, name: me.name, photoURL: me.photoURL ?? null, at },
  });
}

export async function declineFriendRequest(meUid: string, otherUid: string) {
  await update(ref(db), {
    [`friendRequests/outgoing/${otherUid}/${meUid}`]: null,
    [`friendRequests/incoming/${meUid}/${otherUid}`]: null,
  });
}

export async function unfriend(meUid: string, otherUid: string) {
  await update(ref(db), {
    [`friends/${meUid}/${otherUid}`]: null,
    [`friends/${otherUid}/${meUid}`]: null,
  });
}

export function listenFriendStatus(meUid: string, otherUid: string, cb: (status: FriendStatus) => void) {
  let outgoing = false, incoming = false, friendByMe = false, friendByOther = false;
  const emit = () => cb(friendByMe || friendByOther ? 'friends' : outgoing ? 'requested' : incoming ? 'incoming' : 'none');
  const u1 = onValue(ref(db, `friends/${meUid}/${otherUid}`), (s) => { friendByMe = s.exists(); emit(); });
  const u2 = onValue(ref(db, `friends/${otherUid}/${meUid}`), (s) => { friendByOther = s.exists(); emit(); });
  const u3 = onValue(ref(db, `friendRequests/outgoing/${meUid}/${otherUid}`), (s) => { outgoing = s.exists(); emit(); });
  const u4 = onValue(ref(db, `friendRequests/incoming/${meUid}/${otherUid}`), (s) => { incoming = s.exists(); emit(); });
  return () => { u1(); u2(); u3(); u4(); };
}

export function listenIncomingRequests(meUid: string, cb: (items: FriendEdge[]) => void) {
  return onValue(ref(db, `friendRequests/incoming/${meUid}`), (snap) => {
    const out: FriendEdge[] = [];
    snap.forEach((c) => { out.push(c.val() as FriendEdge); });
    out.sort((a, b) => b.at - a.at);
    cb(out);
  });
}

export function listenFriends(meUid: string, cb: (items: FriendEdge[]) => void) {
  return onValue(ref(db, `friends/${meUid}`), (snap) => {
    const out: FriendEdge[] = [];
    snap.forEach((c) => { out.push(c.val() as FriendEdge); });
    out.sort((a, b) => b.at - a.at);
    cb(out);
  });
}

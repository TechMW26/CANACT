/**
 * Lightweight WebRTC voice-call service. Signaling via Firebase Realtime DB
 * under `calls/{callId}` and `incomingCalls/{toUid}/{callId}`. Audio-only v1.
 *
 * Schema:
 *   calls/{callId} = {
 *     from:   { uid, name, photoURL? },
 *     to:     { uid, name, photoURL? },
 *     helpId?: string,
 *     status: 'ringing' | 'active' | 'ended' | 'rejected' | 'missed',
 *     offer?:  RTCSessionDescriptionInit,
 *     answer?: RTCSessionDescriptionInit,
 *     candidates: { caller: { [k]: RTCIceCandidateInit }, callee: { ... } },
 *     createdAt, endedAt?
 *   }
 *   incomingCalls/{toUid}/{callId} = true   (cleared once handled)
 */
import {
  ref,
  push,
  set,
  update,
  onValue,
  remove,
  onChildAdded,
  get,
} from 'firebase/database';
import { db } from '../firebase';

export type CallStatus = 'ringing' | 'active' | 'ended' | 'rejected' | 'missed';

export interface CallRecord {
  id: string;
  from: { uid: string; name: string; photoURL?: string };
  to: { uid: string; name: string; photoURL?: string };
  helpId?: string;
  status: CallStatus;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  createdAt: number;
  endedAt?: number;
}

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

/** Caller — create a new call record + incoming pointer. */
export async function createCall(args: {
  from: { uid: string; name: string; photoURL?: string };
  to: { uid: string; name: string; photoURL?: string };
  helpId?: string;
}) {
  const node = push(ref(db, 'calls'));
  const id = node.key as string;
  const rec: CallRecord = {
    id,
    from: args.from,
    to: args.to,
    helpId: args.helpId,
    status: 'ringing',
    createdAt: Date.now(),
  };
  // Strip undefined helpId to keep RTDB happy.
  const clean: any = { ...rec };
  if (clean.helpId === undefined) delete clean.helpId;
  await set(node, clean);
  await set(ref(db, `incomingCalls/${args.to.uid}/${id}`), true);
  return id;
}

export async function setCallOffer(callId: string, offer: RTCSessionDescriptionInit) {
  await update(ref(db, `calls/${callId}`), { offer });
}
export async function setCallAnswer(callId: string, answer: RTCSessionDescriptionInit) {
  await update(ref(db, `calls/${callId}`), { answer, status: 'active' });
}
export async function setCallStatus(callId: string, status: CallStatus) {
  await update(ref(db, `calls/${callId}`), { status, ...(status === 'ended' || status === 'rejected' || status === 'missed' ? { endedAt: Date.now() } : {}) });
}

export function listenCall(callId: string, cb: (c: CallRecord | null) => void) {
  return onValue(ref(db, `calls/${callId}`), (s) => cb(s.val()));
}

export async function clearIncoming(toUid: string, callId: string) {
  await remove(ref(db, `incomingCalls/${toUid}/${callId}`));
}

export function listenIncomingCalls(uid: string, cb: (calls: CallRecord[]) => void) {
  return onValue(ref(db, `incomingCalls/${uid}`), async (snap) => {
    const ids: string[] = [];
    snap.forEach((c) => { ids.push(c.key as string); });
    const out: CallRecord[] = [];
    await Promise.all(ids.map(async (id) => {
      const s = await get(ref(db, `calls/${id}`));
      const v = s.val() as CallRecord | null;
      if (v && v.status === 'ringing') out.push(v);
      else if (v) await remove(ref(db, `incomingCalls/${uid}/${id}`));
    }));
    cb(out);
  });
}

/** Watch the candidates list for the OTHER party as they arrive. */
export function listenIceCandidates(
  callId: string,
  side: 'caller' | 'callee',
  onCand: (c: RTCIceCandidateInit) => void,
) {
  return onChildAdded(ref(db, `calls/${callId}/candidates/${side}`), (s) => {
    const v = s.val() as RTCIceCandidateInit;
    if (v) onCand(v);
  });
}

export async function pushIceCandidate(
  callId: string,
  side: 'caller' | 'callee',
  cand: RTCIceCandidateInit,
) {
  await push(ref(db, `calls/${callId}/candidates/${side}`), cand);
}

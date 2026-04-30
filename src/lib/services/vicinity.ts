import {
  ref, set, update, remove, onValue, onDisconnect, get, runTransaction,
} from 'firebase/database';
import { db } from '../firebase';
import type { PresenceEntry, Encounter, PendingRating, UserProfile } from '../types';
import { haversineMeters } from '../utils';
import { sendPush } from './sendPush';

/* Tunable thresholds — chosen for accurate "they were really together" detection. */
export const VICINITY = {
  /** Effective max distance to count as "in vicinity" (meters). */
  RADIUS: 50,
  /** Hard ceiling: any sample whose accuracy is worse than this is discarded. */
  MAX_ACCURACY: 80,
  /** Extra slack we allow on top of the radius based on combined GPS accuracy. */
  ACC_SLACK: 30,
  /** Encounter must persist this long before it qualifies for a rating. */
  MIN_DURATION_MS: 45_000,
  /** Encounter must have at least this many in-vicinity samples to qualify. */
  MIN_SAMPLES: 3,
  /** No fresh sighting for this long → considered departed. Must be at least
   *  10 minutes so the rating prompt only appears after a real separation,
   *  not transient GPS jitter. */
  DEPART_GAP_MS: 10 * 60_000,
  /** Presence entries older than this are ignored as stale. */
  PRESENCE_STALE_MS: 90_000,
  /** How often (ms) we write our own presence + scan for nearby users. */
  TICK_MS: 20_000,
  /** Cooldown after I rate or dismiss a person — don't ask again for them
   *  during this window even if we re-encounter. */
  RATING_COOLDOWN_MS: 24 * 60 * 60_000,
};

export function pairKeyOf(a: string, b: string) {
  return [a, b].sort().join('__');
}

/* ---------- Presence I/O ---------- */

export async function writePresence(p: PresenceEntry) {
  const r = ref(db, `presence/${p.uid}`);
  await set(r, p);
  // Auto-clear when the client disconnects.
  try { onDisconnect(r).remove(); } catch { /* ignore */ }
}

export async function clearPresence(uid: string) {
  await remove(ref(db, `presence/${uid}`));
}

/* ---------- Encounter math ---------- */

interface ScanResult {
  pendingForMe: PendingRating[];
}

async function tickEncounter(
  myUid: string,
  myName: string,
  myPhoto: string | undefined,
  other: PresenceEntry,
  distance: number,
) {
  const key = pairKeyOf(myUid, other.uid);
  const r = ref(db, `encounters/${key}`);
  await runTransaction(r, (cur: Encounter | null) => {
    const now = Date.now();
    if (!cur) {
      const e: Encounter = {
        a: myUid, b: other.uid,
        startedAt: now, lastSeen: now,
        samples: 1,
        closestMeters: Math.round(distance),
      };
      return e;
    }
    cur.lastSeen = now;
    cur.samples = (cur.samples ?? 0) + 1;
    cur.closestMeters = Math.min(cur.closestMeters ?? 1e9, Math.round(distance));
    if (!cur.qualified
      && cur.samples >= VICINITY.MIN_SAMPLES
      && (now - cur.startedAt) >= VICINITY.MIN_DURATION_MS) {
      cur.qualified = true;
    }
    return cur;
  });
  // Make sure the other user has a hint of who I am for their popup
  // (their client will create their own pendingRating from their own presence scan).
  await update(ref(db, `encounters/${key}/meta`), {
    [`${myUid}_name`]: myName,
    [`${myUid}_photo`]: myPhoto ?? null,
  });
}

async function maybeFinalizeDeparted(myUid: string) {
  // Pull all encounters that involve me. We keep this read scoped by filtering client-side.
  // Encounters only exist while two people are/were near, so the count stays tiny.
  const snap = await get(ref(db, 'encounters'));
  const all = (snap.val() ?? {}) as Record<string, Encounter & { meta?: any }>;
  const now = Date.now();
  for (const [key, enc] of Object.entries(all)) {
    if (!enc) continue;
    if (enc.a !== myUid && enc.b !== myUid) continue;
    const stale = (now - (enc.lastSeen ?? 0)) > VICINITY.DEPART_GAP_MS;
    if (!stale) continue;
    if (enc.qualified) {
      const otherUid = enc.a === myUid ? enc.b : enc.a;
      // Skip if I already rated/dismissed this person within the cooldown.
      const ratedSnap = await get(ref(db, `ratedPairs/${myUid}/${otherUid}`));
      const rated = ratedSnap.val() as { at: number } | null;
      if (rated && (now - (rated.at ?? 0)) < VICINITY.RATING_COOLDOWN_MS) {
        // Mark this encounter as handled to prevent re-prompts within cooldown.
        await remove(ref(db, `encounters/${key}`));
        continue;
      }
      const meta = (enc as any).meta ?? {};
      const otherName = meta[`${otherUid}_name`] ?? 'Someone nearby';
      const otherPhoto = meta[`${otherUid}_photo`] ?? undefined;
      const pending: PendingRating = {
        pairKey: key,
        otherUid,
        otherName,
        otherPhoto,
        encounteredAt: enc.startedAt,
        departedAt: enc.lastSeen,
        durationMs: Math.max(0, enc.lastSeen - enc.startedAt),
      };
      await set(ref(db, `pendingRatings/${myUid}/${key}`), pending);
      // Notify the rater that there is someone waiting to be rated.
      sendPush({
        toUid: myUid,
        title: 'Rate your recent meet',
        body: `How was your interaction with ${otherName}?`,
        url: '/feed',
        tag: `rate:${key}`,
      });
      // Clear the encounter so a fresh one will be created if we meet again later.
      await remove(ref(db, `encounters/${key}`));
      continue;
    }
    // Only the user whose tick discovers it removes the encounter when *both* sides are stale.
    // Heuristic: if the gap is well past the threshold, just remove.
    if ((now - (enc.lastSeen ?? 0)) > VICINITY.DEPART_GAP_MS * 2) {
      await remove(ref(db, `encounters/${key}`));
    }
  }
}

/* ---------- Tracker lifecycle ---------- */

export interface VicinityHandle {
  stop: () => void;
}

interface StartOpts {
  uid: string;
  profile: Pick<UserProfile, 'fullName' | 'photoURL'>;
}

export function startVicinity(opts: StartOpts): VicinityHandle {
  const { uid, profile } = opts;
  const name = profile.fullName || 'Someone';
  const photo = profile.photoURL;

  let lastFix: { lat: number; lng: number; accuracy: number; ts: number } | null = null;
  let watchId: number | null = null;
  let timer: any = null;
  let presenceCache: Record<string, PresenceEntry> = {};
  let stopped = false;

  const presenceListener = onValue(ref(db, 'presence'), (snap) => {
    presenceCache = (snap.val() ?? {}) as Record<string, PresenceEntry>;
  });

  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    try {
      watchId = navigator.geolocation.watchPosition(
        (p) => {
          lastFix = {
            lat: p.coords.latitude,
            lng: p.coords.longitude,
            accuracy: p.coords.accuracy,
            ts: Date.now(),
          };
        },
        () => { /* ignore — tick will simply not write presence */ },
        { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
      );
    } catch { /* unsupported */ }
  }

  const tick = async () => {
    if (stopped) return;
    try {
      const now = Date.now();
      // 1) Write my own presence if we have a fresh, accurate enough fix.
      if (lastFix && (now - lastFix.ts) < 30_000 && lastFix.accuracy <= VICINITY.MAX_ACCURACY) {
        await writePresence({
          uid, name, photoURL: photo,
          lat: lastFix.lat, lng: lastFix.lng, accuracy: lastFix.accuracy,
          updatedAt: now,
        });
        // Persist a stable last-known location separately from presence so
        // server-side fan-out (e.g. nearby-friend post notifications) can
        // still reach friends who are offline / not currently tracking.
        try {
          await update(ref(db, `users/${uid}/lastLocation`), {
            lat: lastFix.lat, lng: lastFix.lng, at: now,
          });
        } catch { /* ignore */ }

        // 2) Find people in vicinity right now.
        const me = { lat: lastFix.lat, lng: lastFix.lng };
        for (const other of Object.values(presenceCache)) {
          if (!other || other.uid === uid) continue;
          if (!other.updatedAt || (now - other.updatedAt) > VICINITY.PRESENCE_STALE_MS) continue;
          if (other.accuracy && other.accuracy > VICINITY.MAX_ACCURACY) continue;
          const d = haversineMeters(me, { lat: other.lat, lng: other.lng });
          const slack = Math.min(VICINITY.ACC_SLACK, ((other.accuracy ?? 0) + (lastFix.accuracy ?? 0)) / 2);
          if (d <= VICINITY.RADIUS + slack) {
            await tickEncounter(uid, name, photo, other, d);
          }
        }
      }
      // 3) Always check whether any of *my* encounters should be finalized.
      await maybeFinalizeDeparted(uid);
    } catch {
      /* swallow — tracker is best-effort */
    }
  };

  // First tick fires shortly after we get an initial fix.
  const initial = setTimeout(tick, 4_000);
  timer = setInterval(tick, VICINITY.TICK_MS);

  // When the tab is hidden we still want a final ping out.
  const visHandler = () => {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'visible') tick();
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', visHandler);
  }

  return {
    stop: () => {
      stopped = true;
      clearTimeout(initial);
      if (timer) clearInterval(timer);
      if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
      presenceListener();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visHandler);
      clearPresence(uid).catch(() => {});
    },
  };
}

/* ---------- Pending rating subscription + submission ---------- */

export function listenPendingRatings(uid: string, cb: (list: PendingRating[]) => void) {
  return onValue(ref(db, `pendingRatings/${uid}`), (snap) => {
    const v = (snap.val() ?? {}) as Record<string, PendingRating>;
    cb(Object.values(v).sort((a, b) => b.departedAt - a.departedAt));
  });
}

export async function dismissPendingRating(uid: string, pairKey: string) {
  // Extract the other uid from the deterministic pair key so we can record
  // the cooldown marker against this specific person.
  const otherUid = pairKey.split('__').find((p) => p !== uid);
  await remove(ref(db, `pendingRatings/${uid}/${pairKey}`));
  if (otherUid) {
    await set(ref(db, `ratedPairs/${uid}/${otherUid}`), { at: Date.now(), dismissed: true });
  }
}

/**
 * Apply a 1-5 star encounter rating from `fromUid` to `toUid`.
 * Stars 4-5 = positive vote, 1-2 = negative, 3 = neutral (no rating impact).
 * Stores the raw rating sample under `proximityRatings/{toUid}/{pairKey}` for audit.
 */
export async function submitProximityRating(fromUid: string, toUid: string, pairKey: string, stars: number) {
  const s = Math.max(1, Math.min(5, Math.round(stars)));
  await set(ref(db, `proximityRatings/${toUid}/${pairKey}`), {
    fromUid, stars: s, at: Date.now(),
  });
  if (s !== 3) {
    const positive = s >= 4;
    await runTransaction(ref(db, `users/${toUid}`), (u: UserProfile | null) => {
      if (!u) return u;
      u.likesCount = u.likesCount ?? 0;
      u.dislikesCount = u.dislikesCount ?? 0;
      if (positive) u.likesCount += 1; else u.dislikesCount += 1;
      const total = u.likesCount + u.dislikesCount;
      u.rating = total === 0 ? 0 : Math.max(0, Math.min(5, (u.likesCount / total) * 5));
      u.ratingCount = total;
      return u;
    });
  }
  // Record cooldown marker so we don't re-prompt for the same person.
  await set(ref(db, `ratedPairs/${fromUid}/${toUid}`), { at: Date.now(), stars: s });
  await remove(ref(db, `pendingRatings/${fromUid}/${pairKey}`));
}

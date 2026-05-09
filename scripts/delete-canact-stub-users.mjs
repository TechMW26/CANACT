#!/usr/bin/env node
/**
 * scripts/delete-canact-stub-users.mjs
 *
 * One-off cleanup: remove "uncreated" placeholder users whose `fullName`
 * literally matches "Canact user" / "CANACT User" (case-insensitive, trimmed).
 *
 * For each matched UID this script removes (or in --dry-run mode, just lists):
 *   - Firebase Auth account (admin.auth().deleteUser)
 *   - Realtime DB profile and every cross-referenced node
 *     (posts, polls, reels, stories, comments, votes, calls, chats,
 *      friend graph, presence, encounters, help, notifications, etc.)
 *   - Vercel Blob media files under  {kind}/{uid}/...
 *
 * Usage:
 *   # Dry-run (default — prints plan, deletes nothing):
 *   node --env-file=.env.local scripts/delete-canact-stub-users.mjs
 *
 *   # Apply for real:
 *   node --env-file=.env.local scripts/delete-canact-stub-users.mjs --apply
 *
 * Required env (already used elsewhere in this repo):
 *   FIREBASE_SERVICE_ACCOUNT_JSON   service account JSON (string)
 *   NEXT_PUBLIC_FIREBASE_DB_URL     RTDB url
 *   BLOB_READ_WRITE_TOKEN           Vercel Blob token (optional — if missing,
 *                                   blob deletion is skipped with a warning)
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';

const APPLY = process.argv.includes('--apply');
const TARGET_NAMES = new Set(['canact user']); // lowercased exact match

// Optional: target by phone number(s) instead of (or in addition to) name.
// Pass one or more `--phone=+E164` flags. Numbers without a leading `+` are
// auto-prefixed with `+`.
const TARGET_PHONES = process.argv
  .filter((arg) => arg.startsWith('--phone='))
  .map((arg) => arg.slice('--phone='.length).trim())
  .map((p) => (p.startsWith('+') ? p : `+${p}`))
  .filter(Boolean);

// ---------- bootstrap ----------
const svcRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!svcRaw) {
  console.error('FIREBASE_SERVICE_ACCOUNT_JSON env var is required.');
  process.exit(1);
}
const dbUrl =
  process.env.NEXT_PUBLIC_FIREBASE_DB_URL ||
  'https://canact-94ad6-default-rtdb.asia-southeast1.firebasedatabase.app';

if (!getApps().length) {
  initializeApp({ credential: cert(JSON.parse(svcRaw)), databaseURL: dbUrl });
}
const db = getDatabase();
const auth = getAuth();

const banner = APPLY
  ? '\n*** APPLY MODE — destructive changes will be written ***\n'
  : '\n--- DRY RUN — nothing will be deleted (use --apply to commit) ---\n';
console.log(banner);
console.log('Database:', dbUrl);

// ---------- helpers ----------
async function snap(path) {
  const s = await db.ref(path).get();
  return s.exists() ? s.val() : null;
}

/** Apply a flat updates object ( { '/full/path': null, ... } ) */
async function commitUpdates(updates, label) {
  const keys = Object.keys(updates);
  if (!keys.length) {
    console.log(`  · ${label}: nothing to delete`);
    return;
  }
  console.log(`  · ${label}: ${keys.length} path(s)`);
  for (const k of keys) console.log(`      del  ${k}`);
  if (APPLY) await db.ref().update(updates);
}

// ---------- step 1: find target uids ----------
console.log('\n[1/4] Resolving target uids…');
const targetUids = [];
const usersAll = (await snap('users')) || {};

// 1a: by phone number — resolve via Firebase Auth
for (const phone of TARGET_PHONES) {
  try {
    const rec = await auth.getUserByPhoneNumber(phone);
    targetUids.push(rec.uid);
    console.log(`  phone ${phone} → uid ${rec.uid}`);
  } catch (e) {
    console.log(`  phone ${phone} → NOT FOUND in Auth (${e?.code || e?.message})`);
  }
}

// 1b: by stub fullName in RTDB
for (const [uid, u] of Object.entries(usersAll)) {
  const name = String(u?.fullName ?? '').trim().toLowerCase();
  if (TARGET_NAMES.has(name) && !targetUids.includes(uid)) targetUids.push(uid);
}

console.log(`  total ${targetUids.length} target uid(s):`);
for (const uid of targetUids) {
  const u = usersAll[uid] || {};
  console.log(`    - ${uid}  (fullName="${u.fullName ?? '—'}", email=${u.email ?? '—'})`);
}
if (!targetUids.length) {
  console.log('Nothing to do.');
  process.exit(0);
}
const targetSet = new Set(targetUids);

// ---------- step 2: load top-level nodes once ----------
console.log('\n[2/4] Loading cross-referenced nodes (one-time scan)…');
const nodes = {};
for (const path of [
  'wha', 'whaComments', 'userPosts',
  'polls', 'pollComments', 'userPolls',
  'reels', 'userReels',
  'stories',
  'chatThreads', 'chatMessages', 'userThreads',
  'help', 'userHelps',
  'calls', 'incomingCalls',
  'votes',
  'friends', 'friendRequests', 'favourites', 'followRequests', 'blocks',
  'presence', 'encounters', 'ratedPairs',
  'ratemeSessions',
  'notifications',
  'reports',
]) {
  process.stdout.write(`  · ${path}…`);
  nodes[path] = (await snap(path)) || {};
  process.stdout.write(` ${Object.keys(nodes[path]).length}\n`);
}

// ---------- step 3: build + apply per-uid plan ----------
console.log('\n[3/4] Building deletion plan per uid…');

for (const uid of targetUids) {
  console.log(`\n=== uid: ${uid} ===`);
  const updates = {};

  // user core
  updates[`/users/${uid}`] = null;

  // notifications & presence & ratemeSessions owned by uid
  if (nodes.notifications[uid]) updates[`/notifications/${uid}`] = null;
  if (nodes.presence[uid]) updates[`/presence/${uid}`] = null;
  if (nodes.ratedPairs[uid]) updates[`/ratedPairs/${uid}`] = null;
  if (nodes.incomingCalls[uid]) updates[`/incomingCalls/${uid}`] = null;
  if (nodes.userHelps[uid]) updates[`/userHelps/${uid}`] = null;
  if (nodes.userPosts[uid]) updates[`/userPosts/${uid}`] = null;
  if (nodes.userPolls[uid]) updates[`/userPolls/${uid}`] = null;
  if (nodes.userReels[uid]) updates[`/userReels/${uid}`] = null;
  if (nodes.userThreads[uid]) updates[`/userThreads/${uid}`] = null;

  // social graph: my side
  for (const root of ['friends', 'favourites', 'followRequests', 'blocks']) {
    if (nodes[root][uid]) updates[`/${root}/${uid}`] = null;
  }
  if (nodes.friendRequests?.incoming?.[uid]) updates[`/friendRequests/incoming/${uid}`] = null;
  if (nodes.friendRequests?.outgoing?.[uid]) updates[`/friendRequests/outgoing/${uid}`] = null;

  // social graph: other side references back to uid
  for (const root of ['friends', 'favourites', 'followRequests', 'blocks']) {
    for (const [otherUid, sub] of Object.entries(nodes[root] || {})) {
      if (otherUid === uid) continue;
      if (sub && typeof sub === 'object' && uid in sub) {
        updates[`/${root}/${otherUid}/${uid}`] = null;
      }
    }
  }
  for (const dir of ['incoming', 'outgoing']) {
    for (const [otherUid, sub] of Object.entries(nodes.friendRequests?.[dir] || {})) {
      if (otherUid === uid) continue;
      if (sub && typeof sub === 'object' && uid in sub) {
        updates[`/friendRequests/${dir}/${otherUid}/${uid}`] = null;
      }
    }
  }
  for (const [otherUid, sub] of Object.entries(nodes.ratedPairs || {})) {
    if (otherUid === uid) continue;
    if (sub && typeof sub === 'object' && uid in sub) {
      updates[`/ratedPairs/${otherUid}/${uid}`] = null;
    }
  }

  // votes received
  if (nodes.votes[uid]) updates[`/votes/${uid}`] = null;
  // votes given by uid (votes/{toUid}/{fromUid}/...)
  for (const [toUid, voters] of Object.entries(nodes.votes || {})) {
    if (toUid === uid) continue;
    if (voters && typeof voters === 'object' && uid in voters) {
      updates[`/votes/${toUid}/${uid}`] = null;
    }
  }

  // encounters: composite key contains uid
  for (const key of Object.keys(nodes.encounters || {})) {
    if (key.includes(uid)) updates[`/encounters/${key}`] = null;
  }

  // wha: posts authored by uid + reactions/comments by uid on others
  for (const [postId, post] of Object.entries(nodes.wha || {})) {
    if (post?.from?.uid === uid || post?.uid === uid) {
      updates[`/wha/${postId}`] = null;
      if (nodes.whaComments[postId]) updates[`/whaComments/${postId}`] = null;
      continue;
    }
    if (post?.reactionVoters && typeof post.reactionVoters === 'object' && uid in post.reactionVoters) {
      updates[`/wha/${postId}/reactionVoters/${uid}`] = null;
    }
  }
  for (const [postId, comments] of Object.entries(nodes.whaComments || {})) {
    if (updates[`/whaComments/${postId}`] === null) continue;
    for (const [commentId, c] of Object.entries(comments || {})) {
      if (c?.uid === uid) updates[`/whaComments/${postId}/${commentId}`] = null;
    }
  }

  // polls
  for (const [pollId, poll] of Object.entries(nodes.polls || {})) {
    if (poll?.uid === uid || poll?.from?.uid === uid) {
      updates[`/polls/${pollId}`] = null;
      if (nodes.pollComments[pollId]) updates[`/pollComments/${pollId}`] = null;
      continue;
    }
    if (poll?.reactionVoters && typeof poll.reactionVoters === 'object' && uid in poll.reactionVoters) {
      updates[`/polls/${pollId}/reactionVoters/${uid}`] = null;
    }
  }
  for (const [pollId, comments] of Object.entries(nodes.pollComments || {})) {
    if (updates[`/pollComments/${pollId}`] === null) continue;
    for (const [commentId, c] of Object.entries(comments || {})) {
      if (c?.uid === uid) updates[`/pollComments/${pollId}/${commentId}`] = null;
    }
  }

  // reels
  for (const [reelId, reel] of Object.entries(nodes.reels || {})) {
    if (reel?.uid === uid || reel?.from?.uid === uid) {
      updates[`/reels/${reelId}`] = null;
      continue;
    }
    if (reel?.likes && typeof reel.likes === 'object' && uid in reel.likes) {
      updates[`/reels/${reelId}/likes/${uid}`] = null;
    }
  }

  // stories: top-level keyed by owner uid
  if (nodes.stories[uid]) updates[`/stories/${uid}`] = null;
  for (const [ownerUid, ownerStories] of Object.entries(nodes.stories || {})) {
    if (ownerUid === uid) continue;
    if (!ownerStories || typeof ownerStories !== 'object') continue;
    for (const [storyId, story] of Object.entries(ownerStories)) {
      if (story && typeof story === 'object' && story.viewers && uid in story.viewers) {
        updates[`/stories/${ownerUid}/${storyId}/viewers/${uid}`] = null;
      }
    }
  }

  // help
  for (const [helpId, h] of Object.entries(nodes.help || {})) {
    if (h?.creatorUid === uid) {
      updates[`/help/${helpId}`] = null;
      continue;
    }
    for (const branch of ['acceptedBy', 'confirmedHelpers', 'helpThreads', 'live']) {
      if (h?.[branch] && typeof h[branch] === 'object' && uid in h[branch]) {
        updates[`/help/${helpId}/${branch}/${uid}`] = null;
      }
    }
  }

  // calls
  for (const [callId, c] of Object.entries(nodes.calls || {})) {
    if (c?.from?.uid === uid || c?.to?.uid === uid) {
      updates[`/calls/${callId}`] = null;
    }
  }

  // chat threads + messages
  for (const [threadId, t] of Object.entries(nodes.chatThreads || {})) {
    const members = t?.members && typeof t.members === 'object' ? t.members : null;
    const involves = members ? uid in members : false;
    if (involves) {
      updates[`/chatThreads/${threadId}`] = null;
      if (nodes.chatMessages[threadId]) updates[`/chatMessages/${threadId}`] = null;
      // remove from each other member's userThreads index
      for (const otherUid of Object.keys(members)) {
        if (otherUid === uid) continue;
        updates[`/userThreads/${otherUid}/${threadId}`] = null;
      }
    }
  }
  // messages authored by uid in threads we did NOT delete entirely
  for (const [threadId, msgs] of Object.entries(nodes.chatMessages || {})) {
    if (updates[`/chatMessages/${threadId}`] === null) continue;
    for (const [mid, m] of Object.entries(msgs || {})) {
      if (m?.uid === uid) updates[`/chatMessages/${threadId}/${mid}`] = null;
      if (m?.reactions && typeof m.reactions === 'object' && uid in m.reactions) {
        updates[`/chatMessages/${threadId}/${mid}/reactions/${uid}`] = null;
      }
    }
  }

  // ratemeSessions authored by uid
  for (const [sid, s] of Object.entries(nodes.ratemeSessions || {})) {
    if (s?.uid === uid) updates[`/ratemeSessions/${sid}`] = null;
  }

  // reports authored by uid
  for (const [postId, perPost] of Object.entries(nodes.reports?.wha || {})) {
    for (const [rid, r] of Object.entries(perPost || {})) {
      if (r?.uid === uid) updates[`/reports/wha/${postId}/${rid}`] = null;
    }
  }

  await commitUpdates(updates, 'RTDB updates');

  // Vercel Blob cleanup
  await deleteBlobsForUid(uid);

  // Auth account
  await deleteAuthUser(uid);
}

// ---------- step 4: blob + auth helpers ----------
async function deleteBlobsForUid(uid) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.log('  · Vercel Blob: BLOB_READ_WRITE_TOKEN missing — skipped');
    return;
  }
  let blob;
  try { blob = await import('@vercel/blob'); }
  catch (e) { console.log(`  · Vercel Blob: import failed (${e?.message}) — skipped`); return; }

  const kinds = ['avatar', 'story', 'reel', 'post', 'poll'];
  const allUrls = [];
  for (const kind of kinds) {
    let cursor;
    do {
      const page = await blob.list({ prefix: `${kind}/${uid}/`, token, cursor });
      for (const b of page.blobs) allUrls.push(b.url);
      cursor = page.cursor;
    } while (cursor);
  }
  if (!allUrls.length) { console.log('  · Vercel Blob: nothing to delete'); return; }
  console.log(`  · Vercel Blob: ${allUrls.length} object(s)`);
  for (const u of allUrls) console.log(`      del  ${u}`);
  if (APPLY) {
    // del() accepts up to 1000 URLs per call
    const chunk = 500;
    for (let i = 0; i < allUrls.length; i += chunk) {
      await blob.del(allUrls.slice(i, i + chunk), { token });
    }
  }
}

async function deleteAuthUser(uid) {
  try {
    const rec = await auth.getUser(uid).catch(() => null);
    if (!rec) { console.log('  · Auth: no account for this uid'); return; }
    console.log(`  · Auth: would delete user ${rec.email || rec.phoneNumber || uid}`);
    if (APPLY) await auth.deleteUser(uid);
  } catch (e) {
    console.log(`  · Auth: error (${e?.message})`);
  }
}

console.log('\n[4/4] Done.');
console.log(APPLY ? 'Changes committed.' : 'Dry-run complete. Re-run with --apply to commit.');
process.exit(0);

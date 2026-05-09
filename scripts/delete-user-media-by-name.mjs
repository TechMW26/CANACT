#!/usr/bin/env node
/**
 * Delete media/posts for a user matched by fullName from RTDB + Vercel Blob.
 *
 * Usage:
 *   node --env-file=.env.local scripts/delete-user-media-by-name.mjs --name "Kushagra Pandey"
 *   node --env-file=.env.local scripts/delete-user-media-by-name.mjs --name "Kushagra Pandey" --apply
 */

const APPLY = process.argv.includes('--apply');
const nameArgIndex = process.argv.findIndex((arg) => arg === '--name');
const nameArgValue = nameArgIndex >= 0 ? process.argv[nameArgIndex + 1] : '';
const TARGET_NAME = String(nameArgValue || '').trim().toLowerCase();

if (!TARGET_NAME) {
  console.error('Missing --name "Full Name"');
  process.exit(1);
}

const dbUrl =
  process.env.NEXT_PUBLIC_FIREBASE_DB_URL ||
  'https://canact-94ad6-default-rtdb.asia-southeast1.firebasedatabase.app';

const baseUrl = dbUrl.endsWith('/') ? dbUrl.slice(0, -1) : dbUrl;

async function snap(path) {
  const r = await fetch(`${baseUrl}/${path}.json`);
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
  const text = await r.text();
  return text === 'null' ? null : JSON.parse(text);
}

async function commitUpdates(updates, label) {
  const keys = Object.keys(updates);
  if (!keys.length) {
    console.log(`  · ${label}: nothing to delete`);
    return;
  }
  console.log(`  · ${label}: ${keys.length} path(s)`);
  for (const k of keys) console.log(`      del  ${k}`);
  if (!APPLY) return;
  for (const path of keys) {
    const clean = path.startsWith('/') ? path.slice(1) : path;
    const r = await fetch(`${baseUrl}/${clean}.json`, { method: 'DELETE' });
    if (!r.ok) throw new Error(`DELETE /${clean}.json -> ${r.status}`);
  }
}

function maybeCollectMediaUrl(urls, value) {
  if (!value || typeof value !== 'string') return;
  if (!/^https?:\/\//i.test(value)) return;
  urls.add(value);
}

async function deleteBlobsByUrls(urls) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.log('  · Vercel Blob: BLOB_READ_WRITE_TOKEN missing — skipped');
    return;
  }
  let blob;
  try {
    blob = await import('@vercel/blob');
  } catch (e) {
    console.log(`  · Vercel Blob: import failed (${e?.message}) — skipped`);
    return;
  }
  if (!urls.length) {
    console.log('  · Vercel Blob: no URLs to delete');
    return;
  }
  console.log(`  · Vercel Blob: ${urls.length} object(s)`);
  for (const u of urls) console.log(`      del  ${u}`);
  if (!APPLY) return;

  const chunk = 500;
  for (let i = 0; i < urls.length; i += chunk) {
    await blob.del(urls.slice(i, i + chunk), { token });
  }
}

console.log(APPLY ? '*** APPLY MODE ***' : '--- DRY RUN ---');
console.log('Database:', baseUrl);
console.log('Target fullName:', TARGET_NAME);

const users = (await snap('users')) || {};
const targetUids = [];
for (const [uid, user] of Object.entries(users)) {
  const fullName = String(user?.fullName || '').trim().toLowerCase();
  if (fullName === TARGET_NAME) targetUids.push(uid);
}

if (!targetUids.length) {
  console.log('No users matched by fullName. Nothing to do.');
  process.exit(0);
}

console.log('Matched uid(s):');
for (const uid of targetUids) {
  const u = users[uid] || {};
  console.log(`  - ${uid} (${u.fullName || '—'}, ${u.email || 'no-email'})`);
}

const wha = (await snap('wha')) || {};
const userPosts = (await snap('userPosts')) || {};
const whaComments = (await snap('whaComments')) || {};

const reels = (await snap('reels')) || {};
const userReels = (await snap('userReels')) || {};
const reelComments = (await snap('reelComments')) || {};

const polls = (await snap('polls')) || {};
const userPolls = (await snap('userPolls')) || {};
const pollComments = (await snap('pollComments')) || {};

const stories = (await snap('stories')) || {};

for (const uid of targetUids) {
  console.log(`\n=== uid: ${uid} ===`);
  const updates = {};
  const mediaUrls = new Set();

  // Wha posts + comments + index
  for (const [postId, post] of Object.entries(wha)) {
    if (post?.uid !== uid && post?.from?.uid !== uid) continue;
    updates[`/wha/${postId}`] = null;
    updates[`/userPosts/${uid}/${postId}`] = null;
    updates[`/whaComments/${postId}`] = null;

    if (Array.isArray(post?.mediaUrls)) {
      for (const url of post.mediaUrls) maybeCollectMediaUrl(mediaUrls, url);
    }
    if (Array.isArray(post?.mediaPosters)) {
      for (const url of post.mediaPosters) maybeCollectMediaUrl(mediaUrls, url);
    }
  }
  if (userPosts[uid]) updates[`/userPosts/${uid}`] = null;

  // Reels + comments + index
  for (const [reelId, reel] of Object.entries(reels)) {
    if (reel?.uid !== uid && reel?.from?.uid !== uid) continue;
    updates[`/reels/${reelId}`] = null;
    updates[`/userReels/${uid}/${reelId}`] = null;
    updates[`/reelComments/${reelId}`] = null;
    maybeCollectMediaUrl(mediaUrls, reel?.videoUrl);
    maybeCollectMediaUrl(mediaUrls, reel?.posterUrl);
  }
  if (userReels[uid]) updates[`/userReels/${uid}`] = null;

  // Polls + comments + index
  for (const [pollId, poll] of Object.entries(polls)) {
    if (poll?.uid !== uid && poll?.from?.uid !== uid) continue;
    updates[`/polls/${pollId}`] = null;
    updates[`/userPolls/${uid}/${pollId}`] = null;
    updates[`/pollComments/${pollId}`] = null;
    maybeCollectMediaUrl(mediaUrls, poll?.photoURL);
  }
  if (userPolls[uid]) updates[`/userPolls/${uid}`] = null;

  // Stories under stories/{uid} (new + legacy layouts)
  const ownStories = stories[uid];
  if (ownStories) {
    if (typeof ownStories?.mediaUrl === 'string') {
      maybeCollectMediaUrl(mediaUrls, ownStories.mediaUrl);
    } else if (typeof ownStories === 'object') {
      for (const story of Object.values(ownStories)) {
        maybeCollectMediaUrl(mediaUrls, story?.mediaUrl);
      }
    }
    updates[`/stories/${uid}`] = null;
  }

  // Defensive cleanup for orphan comments indexes (if any)
  for (const [postId, comments] of Object.entries(whaComments)) {
    if (!comments || typeof comments !== 'object') continue;
    for (const [cid, c] of Object.entries(comments)) {
      if (c?.uid === uid) updates[`/whaComments/${postId}/${cid}`] = null;
    }
  }
  for (const [reelId, comments] of Object.entries(reelComments)) {
    if (!comments || typeof comments !== 'object') continue;
    for (const [cid, c] of Object.entries(comments)) {
      if (c?.uid === uid) updates[`/reelComments/${reelId}/${cid}`] = null;
    }
  }
  for (const [pollId, comments] of Object.entries(pollComments)) {
    if (!comments || typeof comments !== 'object') continue;
    for (const [cid, c] of Object.entries(comments)) {
      if (c?.uid === uid) updates[`/pollComments/${pollId}/${cid}`] = null;
    }
  }

  await commitUpdates(updates, 'RTDB media/post cleanup');
  await deleteBlobsByUrls(Array.from(mediaUrls));
}

console.log('\nDone.');
console.log(APPLY ? 'Changes committed.' : 'Dry-run complete. Re-run with --apply to commit.');
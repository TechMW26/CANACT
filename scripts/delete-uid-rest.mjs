#!/usr/bin/env node
// Cascade-delete a single uid from CANACT RTDB via REST (open rules).
// Usage: node scripts/delete-uid-rest.mjs <uid> [--apply]

const UID = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!UID) { console.error('uid required'); process.exit(1); }

const BASE = 'https://canact-94ad6-default-rtdb.asia-southeast1.firebasedatabase.app';

async function get(path) {
  const r = await fetch(`${BASE}/${path}.json`);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  const t = await r.text();
  return t === 'null' ? null : JSON.parse(t);
}
async function del(path) {
  if (!APPLY) { console.log(`  DRY  DEL /${path}`); return; }
  const r = await fetch(`${BASE}/${path}.json`, { method: 'DELETE' });
  if (!r.ok) console.log(`  ERR  DEL /${path} → ${r.status}`);
  else console.log(`  OK   DEL /${path}`);
}

console.log(APPLY ? '*** APPLY MODE ***' : '--- DRY RUN ---');
console.log('uid:', UID);

// Single-key deletes (paths owned outright by uid)
const ownedPaths = [
  `users/${UID}`,
  `presence/${UID}`,
  `friends/${UID}`,
  `favourites/${UID}`,
  `followRequests/${UID}`,
  `blocks/${UID}`,
  `friendRequests/incoming/${UID}`,
  `friendRequests/outgoing/${UID}`,
  `notifications/${UID}`,
  `incomingCalls/${UID}`,
  `userPosts/${UID}`,
  `userPolls/${UID}`,
  `userReels/${UID}`,
  `userThreads/${UID}`,
  `userHelps/${UID}`,
  `votes/${UID}`,           // votes received
  `ratedPairs/${UID}`,
  `stories/${UID}`,
];
for (const p of ownedPaths) await del(p);

// Cross-references in social graph (other users → me)
console.log('\n[cross-refs in social graph]');
for (const root of ['friends', 'favourites', 'followRequests', 'blocks', 'ratedPairs']) {
  const all = await get(root) || {};
  for (const [other, sub] of Object.entries(all)) {
    if (other === UID) continue;
    if (sub && typeof sub === 'object' && UID in sub) await del(`${root}/${other}/${UID}`);
  }
}
for (const dir of ['incoming', 'outgoing']) {
  const all = await get(`friendRequests/${dir}`) || {};
  for (const [other, sub] of Object.entries(all)) {
    if (other === UID) continue;
    if (sub && typeof sub === 'object' && UID in sub) await del(`friendRequests/${dir}/${other}/${UID}`);
  }
}
// votes given by uid: votes/{toUid}/{UID}
const votesAll = await get('votes') || {};
for (const [toUid, voters] of Object.entries(votesAll)) {
  if (toUid === UID) continue;
  if (voters && typeof voters === 'object' && UID in voters) await del(`votes/${toUid}/${UID}`);
}

// encounters: composite key contains uid
console.log('\n[encounters]');
const encounters = await get('encounters') || {};
for (const k of Object.keys(encounters)) if (k.includes(UID)) await del(`encounters/${k}`);

// wha (posts authored by uid + reactionVoter rows)
console.log('\n[wha posts]');
const wha = await get('wha') || {};
const deletedWha = new Set();
for (const [pid, p] of Object.entries(wha)) {
  if (p?.from?.uid === UID || p?.uid === UID) {
    await del(`wha/${pid}`);
    await del(`whaComments/${pid}`);
    deletedWha.add(pid);
  } else if (p?.reactionVoters && UID in p.reactionVoters) {
    await del(`wha/${pid}/reactionVoters/${UID}`);
  }
}
const whaComments = await get('whaComments') || {};
for (const [pid, comments] of Object.entries(whaComments)) {
  if (deletedWha.has(pid)) continue;
  for (const [cid, c] of Object.entries(comments || {})) {
    if (c?.uid === UID) await del(`whaComments/${pid}/${cid}`);
  }
}

// polls
console.log('\n[polls]');
const polls = await get('polls') || {};
const deletedPolls = new Set();
for (const [pid, p] of Object.entries(polls)) {
  if (p?.uid === UID || p?.from?.uid === UID) {
    await del(`polls/${pid}`); await del(`pollComments/${pid}`); deletedPolls.add(pid);
  } else if (p?.reactionVoters && UID in p.reactionVoters) {
    await del(`polls/${pid}/reactionVoters/${UID}`);
  }
}
const pollComments = await get('pollComments') || {};
for (const [pid, comments] of Object.entries(pollComments)) {
  if (deletedPolls.has(pid)) continue;
  for (const [cid, c] of Object.entries(comments || {})) {
    if (c?.uid === UID) await del(`pollComments/${pid}/${cid}`);
  }
}

// reels
console.log('\n[reels]');
const reels = await get('reels') || {};
for (const [rid, r] of Object.entries(reels)) {
  if (r?.uid === UID || r?.from?.uid === UID) await del(`reels/${rid}`);
  else if (r?.likes && UID in r.likes) await del(`reels/${rid}/likes/${UID}`);
}

// stories: viewer entries on others' stories
console.log('\n[stories viewer cleanup]');
const stories = await get('stories') || {};
for (const [owner, ownerStories] of Object.entries(stories)) {
  if (owner === UID) continue;
  if (!ownerStories || typeof ownerStories !== 'object') continue;
  for (const [sid, s] of Object.entries(ownerStories)) {
    if (s?.viewers && typeof s.viewers === 'object' && UID in s.viewers) {
      await del(`stories/${owner}/${sid}/viewers/${UID}`);
    }
  }
}

// help
console.log('\n[help]');
const help = await get('help') || {};
for (const [hid, h] of Object.entries(help)) {
  if (h?.creatorUid === UID) { await del(`help/${hid}`); continue; }
  for (const branch of ['acceptedBy', 'confirmedHelpers', 'helpThreads', 'live']) {
    if (h?.[branch] && typeof h[branch] === 'object' && UID in h[branch]) {
      await del(`help/${hid}/${branch}/${UID}`);
    }
  }
}

// calls
console.log('\n[calls]');
const calls = await get('calls') || {};
for (const [cid, c] of Object.entries(calls)) {
  if (c?.from?.uid === UID || c?.to?.uid === UID) await del(`calls/${cid}`);
}

// chat threads & messages
console.log('\n[chat]');
const threads = await get('chatThreads') || {};
const deletedThreads = new Set();
for (const [tid, t] of Object.entries(threads)) {
  const members = t?.members && typeof t.members === 'object' ? t.members : null;
  if (members && UID in members) {
    await del(`chatThreads/${tid}`);
    await del(`chatMessages/${tid}`);
    deletedThreads.add(tid);
    for (const other of Object.keys(members)) {
      if (other !== UID) await del(`userThreads/${other}/${tid}`);
    }
  }
}
const chatMessages = await get('chatMessages') || {};
for (const [tid, msgs] of Object.entries(chatMessages)) {
  if (deletedThreads.has(tid)) continue;
  for (const [mid, m] of Object.entries(msgs || {})) {
    if (m?.uid === UID) await del(`chatMessages/${tid}/${mid}`);
    else if (m?.reactions && UID in m.reactions) await del(`chatMessages/${tid}/${mid}/reactions/${UID}`);
  }
}

// ratemeSessions, reports
console.log('\n[ratemeSessions / reports]');
const sessions = await get('ratemeSessions') || {};
for (const [sid, s] of Object.entries(sessions)) if (s?.uid === UID) await del(`ratemeSessions/${sid}`);
const reportsWha = await get('reports/wha') || {};
for (const [pid, perPost] of Object.entries(reportsWha)) {
  for (const [rid, r] of Object.entries(perPost || {})) {
    if (r?.uid === UID) await del(`reports/wha/${pid}/${rid}`);
  }
}

console.log(APPLY ? '\nDONE — RTDB cascade complete.' : '\nDry-run done. Re-run with --apply to commit.');

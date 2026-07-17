#!/usr/bin/env node
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const APPLY = process.argv.includes('--apply');
const databaseURL = process.env.NEXT_PUBLIC_FIREBASE_DB_URL;

if (!databaseURL) {
  console.error('NEXT_PUBLIC_FIREBASE_DB_URL is required.');
  process.exit(1);
}

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
let db = null;
if (serviceAccount) {
  if (!getApps().length) initializeApp({ credential: cert(JSON.parse(serviceAccount)), databaseURL });
  db = getDatabase();
}
const users = db
  ? (await db.ref('users').get()).val() || {}
  : await rest('users', 'GET');
const now = Date.now();
const updates = {};

for (const [uid, profile] of Object.entries(users)) {
  const completed = {};
  const signals = {};
  if (profile?.profileComplete) completed['complete-profile'] = { at: now, points: 0 };
  if (profile?.photoURL) completed['face-identity'] = { at: now, points: 0 };
  if (profile?.profileVerified) completed['verify-identity'] = { at: now, points: 0 };
  for (const taskId of Object.keys(completed)) signals[taskId] = now;
  updates[`users/${uid}/canactScore`] = 0;
  updates[`users/${uid}/scoreAdjustmentOffset`] = calculateAdjustment(profile || {});
  updates[`users/${uid}/scoreResetAt`] = now;
  updates[`users/${uid}/onboarding`] = {
    version: 1,
    points: 0,
    startedAt: now,
    completed,
    signals,
    reminders: {},
    tours: {},
  };
}

console.log(`${APPLY ? 'Resetting' : 'Would reset'} ${Object.keys(users).length} user score(s) to 0.`);
if (APPLY && Object.keys(updates).length) {
  if (db) await db.ref().update(updates);
  else await rest('', 'PATCH', updates);
  console.log('Score reset complete. Votes, attributes, cards, content, and profile data were preserved.');
} else if (!APPLY) {
  console.log('Dry run only. Re-run with --apply to write changes.');
}

async function rest(path, method, body) {
  const response = await fetch(`${databaseURL.replace(/\/$/, '')}/${path}.json`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`Firebase REST ${method} failed (${response.status})`);
  return response.json();
}

function n(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function confidence(count, at) {
  return Math.min(1, Math.max(0, Math.log1p(count) / Math.log1p(at)));
}

function calculateAdjustment(profile) {
  let adjustment = 0;
  const likes = n(profile.likesCount);
  const dislikes = n(profile.dislikesCount);
  const sentimentTotal = likes + dislikes;
  if (sentimentTotal) {
    const sentiment = (likes - dislikes) / sentimentTotal;
    const base = sentiment >= 0 ? sentiment * 55 : sentiment * 120;
    adjustment += Math.max(-120, Math.min(55, base)) * confidence(sentimentTotal, 20);
  }

  const attrs = profile.attrs || {};
  const positive = ['behaviour', 'reliability', 'civic_sense'].reduce((sum, key) => sum + n(attrs[key]), 0);
  const negative = ['rude', 'unreliable', 'uncivil'].reduce((sum, key) => sum + n(attrs[key]), 0);
  const attrTotal = positive + negative;
  if (attrTotal) {
    const bias = (positive - negative) / attrTotal;
    const base = bias >= 0 ? bias * 65 : bias * 140;
    adjustment += Math.max(-140, Math.min(65, base)) * confidence(attrTotal, 16);
  }

  const help = profile.helpStats || {};
  const resolved = n(help.redResolved) + n(help.orangeResolved) + n(help.yellowResolved);
  if (resolved) adjustment += Math.min(45, Math.log1p(resolved) * 18) * ((1.5 * n(help.redResolved) + 1.2 * n(help.orangeResolved) + n(help.yellowResolved)) / resolved);
  const confirmed = n(help.redConfirmed) + n(help.orangeConfirmed) + n(help.yellowConfirmed);
  if (confirmed) adjustment += Math.min(30, Math.log1p(confirmed) * 12) * ((1.5 * n(help.redConfirmed) + 1.2 * n(help.orangeConfirmed) + n(help.yellowConfirmed)) / confirmed);
  if (n(help.yesOutcomes)) adjustment += Math.min(45, 45 * confidence(n(help.yesOutcomes), 10));
  adjustment += n(help.triedGood) * 10 - n(help.triedBad) * 100;
  if (n(help.noShow)) adjustment -= Math.min(100, Math.log1p(n(help.noShow)) * 40);

  const contentLikes = n(profile.contentLikes);
  const contentDislikes = n(profile.contentDislikes);
  const contentTotal = contentLikes + contentDislikes;
  if (contentTotal) {
    const sentiment = (contentLikes - contentDislikes) / contentTotal;
    adjustment += Math.max(-60, Math.min(40, sentiment >= 0 ? sentiment * 40 : sentiment * 60)) * confidence(contentTotal, 30);
  }
  adjustment += Math.min(10, n(profile.contentEngagementScore));

  const cards = profile.cardsReceived || {};
  const cardTotal = ['understanding', 'humour', 'goodVibes', 'confidence', 'cooperative', 'intelligence', 'creativity', 'daring']
    .reduce((sum, key) => sum + n(cards[key]), 0);
  if (cardTotal) adjustment += Math.min(25, Math.log1p(cardTotal) * 10);
  const badges = Array.isArray(profile.badges) ? profile.badges.filter((badge) => String(badge).toLowerCase() !== 'verified').length : 0;
  adjustment += Math.min(10, badges * 2);
  return adjustment;
}

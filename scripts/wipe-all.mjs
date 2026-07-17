#!/usr/bin/env node
/**
 * scripts/wipe-all.mjs
 *
 * ⚠️  IRREVERSIBLE — wipes the ENTIRE CANACT environment:
 *     1. Firebase Realtime Database (all nodes) via REST API
 *     2. Vercel Blob (all media objects)
 *     3. Firebase Auth users (requires FIREBASE_SERVICE_ACCOUNT_JSON —
 *        skipped if unavailable)
 *
 * Usage:
 *   # Dry-run (safe — lists what would be deleted):
 *   node --env-file=.env.local scripts/wipe-all.mjs
 *
 *   # ACTUALLY DELETE EVERYTHING:
 *   node --env-file=.env.local scripts/wipe-all.mjs --apply
 */

const APPLY = process.argv.includes('--apply');

const BANNER = APPLY
  ? '\n🔥🔥🔥  APPLY MODE — ALL DATA WILL BE PERMANENTLY DELETED  🔥🔥🔥\n'
  : '\n--- DRY RUN — nothing will be deleted (use --apply to commit) ---\n';
console.log(BANNER);

// ── Config ──
const DB_URL = (process.env.NEXT_PUBLIC_FIREBASE_DB_URL || 'https://canact-94ad6-default-rtdb.asia-southeast1.firebasedatabase.app').replace(/\/$/, '');

async function restGet(path) {
  const r = await fetch(`${DB_URL}/${path}.json`);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  const t = await r.text();
  return t === 'null' ? null : JSON.parse(t);
}

async function restSet(path, value) {
  if (!APPLY) return;
  const r = await fetch(`${DB_URL}/${path}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  if (!r.ok) throw new Error(`PUT ${path} → ${r.status}`);
}

console.log('Database:', DB_URL);

// ── Step 1: Wipe RTDB ──
console.log('\n[1/3] Realtime Database…');

if (APPLY) {
  console.log('  PUT / → null …');
  await restSet('/', null);
  console.log('  ✅ RTDB wiped.');
} else {
  const root = await restGet('/');
  if (!root || Object.keys(root).length === 0) {
    console.log('  RTDB is already empty.');
  } else {
    const keys = Object.keys(root);
    console.log(`  Found ${keys.length} root key(s):`);
    for (const key of keys) {
      const size = typeof root[key] === 'object' && root[key] !== null
        ? Object.keys(root[key]).length
        : 1;
      console.log(`    /${key} — ${size} entries`);
    }
    console.log(`  Would wipe ${keys.length} root key(s).`);
  }
}

// ── Step 2: Firebase Auth users ──
console.log('\n[2/3] Firebase Auth users…');

const svcRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!svcRaw) {
  console.log('  ⚠️  FIREBASE_SERVICE_ACCOUNT_JSON not set — skipping Auth deletion.');
  console.log('     To delete Auth users, set the env var and re-run with --apply.');
} else {
  try {
    const { initializeApp, cert, getApps } = await import('firebase-admin/app');
    const { getAuth } = await import('firebase-admin/auth');
    if (!getApps().length) {
      initializeApp({ credential: cert(JSON.parse(svcRaw)), databaseURL: DB_URL });
    }
    const auth = getAuth();
    let totalAuthUsers = 0;
    let pageToken = undefined;

    do {
      const listResult = await auth.listUsers(1000, pageToken);
      const users = listResult.users;
      pageToken = listResult.pageToken;
      if (!users.length) break;
      totalAuthUsers += users.length;
      const uids = users.map((u) => u.uid);

      if (APPLY) {
        await auth.deleteUsers(uids);
        console.log(`  Deleted batch of ${uids.length} (running total: ${totalAuthUsers})`);
      } else {
        for (const u of users.slice(0, 15)) {
          console.log(`  [DRY] uid=${u.uid}  email=${u.email || '—'}  phone=${u.phoneNumber || '—'}`);
        }
        if (users.length > 15) console.log(`  … and ${users.length - 15} more in this batch`);
      }
    } while (pageToken);

    if (totalAuthUsers === 0) console.log('  No Auth users found.');
    else if (!APPLY) console.log(`  Would delete ${totalAuthUsers} Auth user(s).`);
    else console.log(`  ✅ Deleted ${totalAuthUsers} Auth user(s).`);
  } catch (e) {
    console.log(`  ⚠️  Auth deletion failed: ${e?.message}`);
  }
}

// ── Step 3: Vercel Blob ──
console.log('\n[3/3] Vercel Blob media…');

const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
if (!blobToken) {
  console.log('  ⚠️  BLOB_READ_WRITE_TOKEN missing — skipping Blob wipe.');
} else {
  try {
    const blob = await import('@vercel/blob');
    let blobCount = 0;
    let cursor;

    do {
      const result = await blob.list({ cursor, limit: 1000, token: blobToken });
      const items = result?.blobs ?? [];
      cursor = result?.cursor;
      if (!items.length) break;

      blobCount += items.length;
      const urls = items.map((b) => b.url);

      if (APPLY) {
        for (let i = 0; i < urls.length; i += 500) {
          await blob.del(urls.slice(i, i + 500), { token: blobToken });
        }
        console.log(`  Deleted batch of ${items.length} (running total: ${blobCount})`);
      } else {
        for (const b of items.slice(0, 20)) {
          console.log(`  [DRY] ${b.pathname}  (${(b.size / 1024).toFixed(1)} KB)`);
        }
        if (items.length > 20) console.log(`  … and ${items.length - 20} more in this batch`);
      }
    } while (cursor);

    if (blobCount === 0) console.log('  Blob store is already empty.');
    else if (!APPLY) console.log(`  Would delete ${blobCount} blob object(s).`);
    else console.log(`  ✅ Deleted ${blobCount} blob object(s).`);
  } catch (e) {
    console.log(`  ⚠️  Blob wipe failed: ${e?.message}`);
  }
}

// ── Done ──
console.log('\n' + '═'.repeat(50));
if (APPLY) {
  console.log('✅ WIPE COMPLETE.');
} else {
  console.log('DRY RUN COMPLETE — run with --apply to actually delete everything.');
}
console.log('═'.repeat(50) + '\n');

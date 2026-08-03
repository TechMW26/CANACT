import { createHmac } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { getFirebaseAdminApp, verifyUserRequest } from '@/lib/server/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CONTACTS = 5000;
const MAX_IDENTIFIERS_PER_CONTACT = 8;

type ContactInput = { phones?: unknown; emails?: unknown };

export async function POST(request: Request) {
  try {
    const app = getFirebaseAdminApp();
    if (!app) return NextResponse.json({ ok: false, reason: 'contacts-unavailable' }, { status: 503 });
    const verified = await verifyUserRequest(request, app);
    if (!verified) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => null) as { contacts?: unknown; countryCode?: unknown } | null;
    if (!Array.isArray(body?.contacts)) return NextResponse.json({ ok: false, reason: 'invalid-contacts' }, { status: 400 });
    if (body.contacts.length > MAX_CONTACTS) return NextResponse.json({ ok: false, reason: 'too-many-contacts' }, { status: 413 });

    const database = getDatabase(app);
    const [profileSnapshot, allProfilesSnapshot, account] = await Promise.all([
      database.ref(`users/${verified.uid}`).get(),
      database.ref('users').get(),
      getAuth(app).getUser(verified.uid),
    ]);
    const currentProfile = (profileSnapshot.val() || {}) as { countryCode?: unknown; mobile?: unknown; email?: unknown };
    const profileRegion = String(currentProfile.countryCode || body.countryCode || '').toUpperCase();
    const region = /^[A-Z]{2}$/.test(profileRegion) ? profileRegion as CountryCode : undefined;
    const rawIdentifiers = normalizeContacts(body.contacts as ContactInput[], region);
    if (!rawIdentifiers.size) return NextResponse.json({ ok: false, reason: 'invalid-contacts' }, { status: 400 });

    const secret = contactHashSecret();
    if (!secret) return NextResponse.json({ ok: false, reason: 'contacts-unavailable' }, { status: 503 });
    const identifierHashes = new Set(Array.from(rawIdentifiers, (identifier) => hashIdentifier(identifier, secret)));
    const matchedUids = new Set<string>();
    allProfilesSnapshot.forEach((child) => {
      const profile = (child.val() || {}) as { uid?: unknown; mobile?: unknown; email?: unknown };
      const uid = String(profile.uid || child.key || '');
      const phone = normalizePhone(String(profile.mobile || ''), region);
      const email = normalizeEmail(String(profile.email || ''));
      if (uid && uid !== verified.uid && ((phone && rawIdentifiers.has(`phone:${phone}`)) || (email && rawIdentifiers.has(`email:${email}`)))) {
        matchedUids.add(uid);
      }
      return undefined;
    });
    const currentUserHashes = hashesForIdentity([
      account.phoneNumber,
      account.email,
      currentProfile.mobile,
      currentProfile.email,
    ], secret, region);

    const [oldSyncSnapshot, oldContactsSnapshot, priorOwnerSnapshots] = await Promise.all([
      database.ref(`contactSyncs/${verified.uid}/identifierHashes`).get(),
      database.ref(`contacts/${verified.uid}`).get(),
      Promise.all(Array.from(currentUserHashes, (hash) => database.ref(`contactIdentifierOwners/${hash}`).get())),
    ]);
    const oldHashes = new Set<string>();
    oldSyncSnapshot.forEach((child) => { if (child.key) oldHashes.add(child.key); return undefined; });
    const oldMatches = new Set<string>();
    oldContactsSnapshot.forEach((child) => { if (child.key) oldMatches.add(child.key); return undefined; });
    const priorOwners = new Set<string>();
    priorOwnerSnapshots.forEach((snapshot) => snapshot.forEach((child) => {
      if (child.key && child.key !== verified.uid) priorOwners.add(child.key);
      return undefined;
    }));

    const now = Date.now();
    const updates: Record<string, unknown> = {
      [`contactSyncs/${verified.uid}`]: {
        schemaVersion: 2,
        syncedAt: now,
        count: body.contacts.length,
        matchedCount: matchedUids.size,
        identifierHashes: Object.fromEntries(Array.from(identifierHashes, (hash) => [hash, true])),
      },
      [`contacts/${verified.uid}`]: matchedUids.size
        ? Object.fromEntries(Array.from(matchedUids, (uid) => [uid, { matchedAt: now, source: 'addressBook' }]))
        : null,
    };

    oldHashes.forEach((hash) => { if (!identifierHashes.has(hash)) updates[`contactIdentifierOwners/${hash}/${verified.uid}`] = null; });
    identifierHashes.forEach((hash) => { updates[`contactIdentifierOwners/${hash}/${verified.uid}`] = true; });
    oldMatches.forEach((uid) => { if (!matchedUids.has(uid)) updates[`contactedBy/${uid}/${verified.uid}`] = null; });
    matchedUids.forEach((uid) => { updates[`contactedBy/${uid}/${verified.uid}`] = { matchedAt: now }; });

    priorOwners.forEach((ownerUid) => {
      updates[`contacts/${ownerUid}/${verified.uid}`] = { matchedAt: now, source: 'addressBook' };
      updates[`contactedBy/${verified.uid}/${ownerUid}`] = { matchedAt: now };
    });

    await database.ref().update(updates);
    return NextResponse.json({ ok: true, synced: body.contacts.length, matched: matchedUids.size });
  } catch (error) {
    console.error('[contacts] sync failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ ok: false, reason: 'contacts-unavailable' }, { status: 500 });
  }
}

function normalizeContacts(contacts: ContactInput[], region?: CountryCode) {
  const identifiers = new Set<string>();
  contacts.forEach((contact) => {
    list(contact.phones).slice(0, MAX_IDENTIFIERS_PER_CONTACT).forEach((value) => {
      const phone = normalizePhone(value, region);
      if (phone) identifiers.add(`phone:${phone}`);
    });
    list(contact.emails).slice(0, MAX_IDENTIFIERS_PER_CONTACT).forEach((value) => {
      const email = normalizeEmail(value);
      if (email) identifiers.add(`email:${email}`);
    });
  });
  return identifiers;
}

function hashesForIdentity(values: unknown[], secret: string, region?: CountryCode) {
  const identifiers = new Set<string>();
  values.forEach((value) => {
    const text = String(value || '');
    const phone = normalizePhone(text, region);
    const email = normalizeEmail(text);
    if (phone) identifiers.add(hashIdentifier(`phone:${phone}`, secret));
    if (email) identifiers.add(hashIdentifier(`email:${email}`, secret));
  });
  return identifiers;
}

function list(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function normalizePhone(value: string, region?: CountryCode) {
  const parsed = parsePhoneNumberFromString(value, region);
  return parsed?.isPossible() ? parsed.number : '';
}

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : '';
}

function hashIdentifier(identifier: string, secret: string) {
  return createHmac('sha256', secret).update(identifier).digest('hex');
}

function contactHashSecret() {
  return process.env.CONTACT_SYNC_HASH_SECRET
    || process.env.FIREBASE_ADMIN_PRIVATE_KEY
    || process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    || '';
}

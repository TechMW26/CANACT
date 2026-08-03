'use client';

import { Capacitor } from '@capacitor/core';
import { getFirebaseAuth } from '@/lib/firebase';

export type ContactSyncRecord = {
  name?: string;
  phones: string[];
  emails: string[];
};

export type ContactSyncResult = {
  synced: number;
  matched: number;
};

export function isNativeContactSyncAvailable() {
  return Capacitor.isNativePlatform();
}

type ContactPickerNavigator = Navigator & {
  contacts?: {
    select: (
      properties: Array<'name' | 'tel' | 'email'>,
      options: { multiple: boolean },
    ) => Promise<Array<{ name?: string[]; tel?: string[]; email?: string[] }>>;
  };
};

export function isWebContactPickerAvailable() {
  if (typeof navigator === 'undefined') return false;
  return typeof (navigator as ContactPickerNavigator).contacts?.select === 'function';
}

/** The browser contact picker must be called directly from a user gesture. */
export async function readWebContacts(): Promise<ContactSyncRecord[]> {
  const picker = (navigator as ContactPickerNavigator).contacts;
  if (!picker?.select) throw new Error('Import a contacts file to sync your address book on this browser.');
  const contacts = await picker.select(['name', 'tel', 'email'], { multiple: true });
  return contacts.map((contact) => ({
    name: contact.name?.[0]?.trim() || undefined,
    phones: unique(contact.tel ?? []),
    emails: unique(contact.email ?? []),
  })).filter((contact) => contact.phones.length || contact.emails.length);
}

export async function readAllDeviceContacts(): Promise<ContactSyncRecord[]> {
  if (!Capacitor.isNativePlatform()) throw new Error('Import a contacts file to sync your full address book on the web.');
  const { Contacts } = await import('@capacitor-community/contacts');
  const permission = await Contacts.requestPermissions();
  if (permission.contacts !== 'granted' && permission.contacts !== 'limited') {
    throw new Error('Contact access was not granted. Enable it in your device settings and try again.');
  }

  const { contacts } = await Contacts.getContacts({
    projection: { name: true, phones: true, emails: true },
  });
  const records = contacts.map((contact) => ({
    name: contact.name?.display || [contact.name?.given, contact.name?.family].filter(Boolean).join(' ') || undefined,
    phones: unique(contact.phones?.map((phone) => phone.number || '') ?? []),
    emails: unique(contact.emails?.map((email) => email.address || '') ?? []),
  })).filter((contact) => contact.phones.length || contact.emails.length);

  if (permission.contacts === 'limited') {
    throw new Error('Only selected contacts are available. Allow full contact access in device settings to sync the complete address book.');
  }
  return records;
}

export async function syncContactRecords(contacts: ContactSyncRecord[], countryCode?: string): Promise<ContactSyncResult> {
  const currentUser = getFirebaseAuth().currentUser;
  if (!currentUser) throw new Error('Sign in with Firebase before syncing contacts.');
  const idToken = await currentUser.getIdToken();
  const response = await fetch('/api/contacts/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({
      contacts: contacts.map(({ phones, emails }) => ({ phones, emails })),
      countryCode,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const messages: Record<string, string> = {
      'contacts-unavailable': 'Contact syncing is temporarily unavailable.',
      'invalid-contacts': 'No valid phone numbers or email addresses were found.',
      'too-many-contacts': 'This address book is too large to sync in one pass.',
    };
    throw new Error(messages[result.reason] || result.error || 'Could not sync contacts.');
  }
  return { synced: Number(result.synced || 0), matched: Number(result.matched || 0) };
}

export function parseVCardContacts(source: string): ContactSyncRecord[] {
  return source.split(/END:VCARD/i).map((block) => {
    const name = decodeVCardValue(block.match(/(?:^|\n)FN[^:]*:([^\r\n]+)/i)?.[1]);
    const phones = Array.from(block.matchAll(/(?:^|\n)TEL[^:]*:([^\r\n]+)/gi), (match) => decodeVCardValue(match[1]));
    const emails = Array.from(block.matchAll(/(?:^|\n)EMAIL[^:]*:([^\r\n]+)/gi), (match) => decodeVCardValue(match[1]));
    return { name: name || undefined, phones: unique(phones), emails: unique(emails) };
  }).filter((contact) => contact.phones.length || contact.emails.length);
}

function decodeVCardValue(value?: string) {
  return String(value || '').trim().replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1');
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

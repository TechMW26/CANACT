import Link from 'next/link';
import { Card } from '@/components/Card';

export default function PrivacyPage() {
  return (
    <main className="space-y-3 py-4">
      <Card>
        <h1 className="text-2xl font-black text-ink">Privacy Policy</h1>
        <p className="mt-1 text-xs text-muted">Last updated 1 August 2026</p>
        <div className="mt-5 space-y-4 text-sm leading-6 text-ink/75">
          <section><h2 className="font-extrabold text-ink">Data Canact uses</h2><p>Canact processes account and profile details, content, connections, community interactions, device notification tokens, and location when you enable nearby features. Identity documents and verification selfies are used only for manual verification review and are restricted to authorised reviewers.</p></section>
          <section><h2 className="font-extrabold text-ink">Why it is used</h2><p>Data is used to provide profiles, messaging, feeds, nearby discovery, safety controls, notifications, support, and service reliability.</p></section>
          <section><h2 className="font-extrabold text-ink">Contact discovery</h2><p>If you choose to sync contacts, Canact uses phone numbers and email addresses only to find accounts you may know. Contact names are not stored. Identifiers are normalized and protected with a server-side keyed hash before being retained, and you can revoke contact permission in your device settings.</p></section>
          <section><h2 className="font-extrabold text-ink">Sharing and controls</h2><p>Your profile and shared content are visible according to the feature and audience you choose. Messaging is limited to accepted connections. Device permissions can be changed in your operating-system settings.</p></section>
          <section><h2 className="font-extrabold text-ink">Retention and deletion</h2><p>Stories expire after your selected duration. Other content remains until removed or until retention is no longer necessary. You can delete your profile from App settings.</p></section>
        </div>
      </Card>
      <Link href="/settings" className="inline-flex rounded-full bg-brand px-4 py-2 text-sm font-bold text-white">Back to settings</Link>
    </main>
  );
}

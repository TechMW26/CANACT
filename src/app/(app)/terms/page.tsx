import Link from 'next/link';
import { Card } from '@/components/Card';

export default function TermsPage() {
  return (
    <main className="space-y-3 py-4">
      <Card>
        <h1 className="text-2xl font-black text-ink">Terms of Service</h1>
        <p className="mt-1 text-xs text-muted">Last updated 1 August 2026</p>
        <div className="mt-5 space-y-4 text-sm leading-6 text-ink/75">
          <section><h2 className="font-extrabold text-ink">Using Canact</h2><p>You must provide accurate account information, protect your account, and use Canact lawfully. Do not impersonate others, harass people, manipulate community signals, or upload content you do not have permission to share.</p></section>
          <section><h2 className="font-extrabold text-ink">Community features</h2><p>Ratings, cards, nearby discovery, help requests, and user content reflect community activity and are not professional advice or guarantees. Proximity and location results can vary with device accuracy.</p></section>
          <section><h2 className="font-extrabold text-ink">Content and safety</h2><p>You retain responsibility for your content and grant Canact permission to host and display it to operate the service. We may restrict or remove accounts or content that threaten safety, integrity, or availability.</p></section>
          <section><h2 className="font-extrabold text-ink">Availability</h2><p>Features may change and the service may occasionally be unavailable. Canact is provided on an as-available basis to the extent permitted by applicable law.</p></section>
        </div>
      </Card>
      <Link href="/settings" className="inline-flex rounded-full bg-brand px-4 py-2 text-sm font-bold text-white">Back to settings</Link>
    </main>
  );
}

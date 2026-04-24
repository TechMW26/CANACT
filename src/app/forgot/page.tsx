'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useAuth } from '@/lib/auth';
import { toast } from '@/components/Toaster';
import { BrandMark } from '@/components/Brand';

export default function ForgotPage() {
  const { forgot } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="min-h-screen p-6 flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-3"><BrandMark size={72} /></div>
          <h1 className="text-3xl font-extrabold text-brand mb-1">Reset password</h1>
          <p className="text-muted">Enter your email and we'll send a reset link.</p>
        </div>
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true);
          try { await forgot(email); toast('Check your inbox for the reset link', 'success'); }
          catch (err: any) { toast(err?.message ?? 'Could not send', 'error'); }
          finally { setBusy(false); }
        }}>
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Button type="submit" full size="lg" loading={busy}>Send reset link</Button>
        </form>
        <p className="mt-4 text-sm text-muted text-center"><Link href="/login" className="text-brand font-semibold">Back to login</Link></p>
      </div>
    </div>
  );
}

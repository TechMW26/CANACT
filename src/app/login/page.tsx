'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useAuth } from '@/lib/auth';
import { toast } from '@/components/Toaster';
import { BrandMark } from '@/components/Brand';

export default function LoginPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-3"><BrandMark size={88} /></div>
            <h1 className="text-4xl font-extrabold text-brand">Canact</h1>
            <p className="mt-2 text-muted">Welcome back. Sign in to continue.</p>
          </div>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try { await signIn(id, pw); router.replace('/feed'); }
              catch (err: any) { toast(err?.message ?? 'Could not sign in', 'error'); }
              finally { setBusy(false); }
            }}
          >
            <Input label="Email or mobile" autoComplete="username" value={id} onChange={(e) => setId(e.target.value)} required />
            <Input label="Password" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
            <Button type="submit" full size="lg" loading={busy}>Sign in</Button>
          </form>
          <div className="mt-4 flex items-center justify-between text-sm">
            <Link href="/forgot" className="font-semibold text-brand">Forgot password?</Link>
            <Link href="/register" className="font-semibold text-ink">Create account</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

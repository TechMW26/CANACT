'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useAuth } from '@/lib/auth';
import { toast } from '@/components/Toaster';
import { BrandMark } from '@/components/Brand';

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [f, setF] = useState({ firstName: '', middleName: '', lastName: '', email: '', mobile: '', password: '', city: '', country: '' });
  const [busy, setBusy] = useState(false);
  const upd = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-3"><BrandMark size={72} /></div>
          <h1 className="text-3xl font-extrabold text-brand mb-1">Create your account</h1>
          <p className="text-muted">Quick sign up. You can verify your profile later.</p>
        </div>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault(); setBusy(true);
            try { await register(f); router.replace('/feed'); }
            catch (err: any) { toast(err?.message ?? 'Registration failed', 'error'); }
            finally { setBusy(false); }
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Input label="First name" value={f.firstName} onChange={upd('firstName')} required />
            <Input label="Last name" value={f.lastName} onChange={upd('lastName')} required />
          </div>
          <Input label="Middle name (optional)" value={f.middleName} onChange={upd('middleName')} />
          <Input label="Email" type="email" autoComplete="email" value={f.email} onChange={upd('email')} required />
          <Input label="Mobile" inputMode="tel" autoComplete="tel" value={f.mobile} onChange={upd('mobile')} required />
          <Input label="Password" type="password" autoComplete="new-password" value={f.password} onChange={upd('password')} required minLength={6} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="City" value={f.city} onChange={upd('city')} />
            <Input label="Country" value={f.country} onChange={upd('country')} />
          </div>
          <Button type="submit" full size="lg" loading={busy}>Create account</Button>
        </form>
        <p className="mt-4 text-sm text-muted text-center">Have an account? <Link href="/login" className="text-brand font-semibold">Sign in</Link></p>
      </div>
    </div>
  );
}

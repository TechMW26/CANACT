'use client';

import { useState, useCallback } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { getFirebaseAuth, db } from '@/lib/firebase';
import { clearLocalPhoneSession } from '@/lib/auth';
import { ref, set } from 'firebase/database';
import { Brand } from '@/components/Brand';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { toast } from '@/components/Toaster';
import { ShieldAlert, Eye, EyeOff } from '@/components/icons';

const ADMIN_EMAIL = 'avi2001raj@gmail.com';

export default function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast('Enter email and password', 'error');
      return;
    }
    if (email.trim().toLowerCase() !== ADMIN_EMAIL) {
      toast('Invalid admin credentials', 'error');
      return;
    }
    setBusy(true);
    try {
      clearLocalPhoneSession();
      const auth = getFirebaseAuth();
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      const uid = cred.user.uid;
      // Write minimal admin profile to RTDB
      await set(ref(db, `users/${uid}`), {
        uid,
        email: ADMIN_EMAIL,
        fullName: 'Admin',
        firstName: 'Admin',
        role: 'admin',
        adminSince: Date.now(),
      });
      toast('Welcome, Admin', 'success');
      // Reload the auth provider from Firebase persistence so a stale local
      // development phone session cannot trigger the dashboard guard.
      window.location.replace('/admin');
    } catch (err: any) {
      const msg = err?.code === 'auth/invalid-credential' || err?.code === 'auth/wrong-password'
        ? 'Invalid email or password'
        : err?.code === 'auth/too-many-requests'
        ? 'Too many attempts. Try again later.'
        : err?.message || 'Login failed';
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  }, [email, password]);

  return (
    <main className="flex min-h-[var(--canact-viewport-height)] items-center justify-center bg-[#F7F4EF] px-4">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 text-center">
          <div className="mb-3 flex justify-center">
            <Brand size={42} />
          </div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#201A17] px-4 py-1.5 text-xs font-extrabold uppercase tracking-wide text-white/80">
            <ShieldAlert size={14} /> Admin access
          </div>
        </div>

        <form onSubmit={handleLogin} className="rounded-2xl border border-[#E8DDD4] bg-white p-6 shadow-sm">
          <h1 className="mb-1 text-xl font-black tracking-tight text-ink">Admin login</h1>
          <p className="mb-6 text-sm text-ink/50">Sign in with your admin credentials.</p>

          <div className="flex flex-col gap-4">
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@canact.app"
              autoComplete="email"
              required
            />
            <div className="relative">
              <Input
                label="Password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-[34px] text-ink/30 hover:text-ink/60"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <Button type="submit" full size="lg" loading={busy} className="mt-1">
              Sign in
            </Button>
          </div>
        </form>

        <p className="mt-6 text-center text-xs text-ink/30">
          This area is restricted to Canact administrators.
        </p>
      </div>
    </main>
  );
}

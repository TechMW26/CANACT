'use client';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onValue, ref, update } from 'firebase/database';
import { db } from './firebase';
import { UserProfile } from './types';

interface SessionUser { uid: string }

interface AuthCtx {
  user: SessionUser | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (idOrEmail: string, password: string) => Promise<void>;
  register: (input: {
    firstName: string; middleName?: string; lastName: string;
    email: string; mobile: string; password: string;
    city?: string; country?: string;
  }) => Promise<void>;
  forgot: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateMyProfile: (patch: Partial<UserProfile>) => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

async function api(path: string, body?: any): Promise<any> {
  const r = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
  return data;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Boot: ask server who we are (validates JWT in httpOnly cookie).
  useEffect(() => {
    (async () => {
      try {
        const me = await api('/api/auth/me');
        if (me?.uid) setUser({ uid: me.uid });
        else setLoading(false);
      } catch {
        setLoading(false);
      }
    })();
  }, []);

  // Profile subscription
  useEffect(() => {
    if (!user) { setProfile(null); return; }
    setLoading(true);
    const off = onValue(ref(db, `users/${user.uid}`), (snap) => {
      const v = snap.val() as UserProfile | null;
      if (!v) {
        fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
          setUser(null); setProfile(null); setLoading(false);
        });
        return;
      }
      setProfile(v); setLoading(false);
    });
    return () => off();
  }, [user?.uid]);

  const value = useMemo<AuthCtx>(() => ({
    user, profile, loading,
    signIn: async (idOrEmail, password) => {
      const r = await api('/api/auth/login', { idOrEmail, password });
      setUser({ uid: r.uid });
    },
    register: async (input) => {
      const r = await api('/api/auth/register', input);
      setUser({ uid: r.uid });
    },
    forgot: async () => {
      throw new Error('Password reset is not configured. Re-register or update from Settings.');
    },
    signOut: async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      setUser(null); setProfile(null);
    },
    updateMyProfile: async (patch) => {
      if (!user) return;
      await update(ref(db, `users/${user.uid}`), patch);
    },
    deleteAccount: async () => {
      await api('/api/auth/delete', {});
      setUser(null); setProfile(null);
    },
  }), [user, profile, loading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

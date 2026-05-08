'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function OnboardPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? '/profile' : '/welcome');
  }, [loading, router, user]);

  return (
    <div className="flex min-h-[var(--canact-viewport-height)] items-center justify-center bg-[#FFF8F8]">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
    </div>
  );
}

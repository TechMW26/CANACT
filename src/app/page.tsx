'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function Home() {
  const router = useRouter();
  const { user, profile, loading } = useAuth();
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/welcome');
    else if (!profile || profile.profileComplete === false) router.replace('/onboard');
    else router.replace('/feed');
  }, [user, profile, loading, router]);
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
    </div>
  );
}

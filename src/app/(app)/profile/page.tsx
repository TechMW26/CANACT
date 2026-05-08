'use client';
import { useAuth } from '@/lib/auth';
import { ProfileBody } from '@/components/ProfileBody';
import { ProfileCompletionPrompt } from '@/components/ProfileCompletionPrompt';

export default function MyProfilePage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <>
      <ProfileBody uid={user.uid} isSelf />
      <ProfileCompletionPrompt />
    </>
  );
}

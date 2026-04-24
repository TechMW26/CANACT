'use client';
import { useAuth } from '@/lib/auth';
import { ProfileBody } from '@/components/ProfileBody';

export default function MyProfilePage() {
  const { user } = useAuth();
  if (!user) return null;
  return <ProfileBody uid={user.uid} isSelf />;
}

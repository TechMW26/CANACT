'use client';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ProfileBody } from '@/components/ProfileBody';

export default function OtherProfilePage() {
  const { uid } = useParams<{ uid: string }>();
  const { user } = useAuth();
  if (!uid) return null;
  return <ProfileBody uid={uid} isSelf={user?.uid === uid} />;
}

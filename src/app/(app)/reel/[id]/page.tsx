'use client';
import { useParams } from 'next/navigation';
import { ReelsScroller } from '@/components/ReelsScroller';

export default function ReelPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id;
  return <ReelsScroller initialReelId={id} />;
}

'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { useAuth } from '@/lib/auth';
import { ConfirmDialog } from '@/components/Modal';
import { toast } from '@/components/Toaster';

export default function SettingsPage() {
  const { user, profile, signOut, updateMyProfile, deleteAccount } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!user || !profile) return null;
  return (
    <div className="space-y-3">
      <Card>
        <h3 className="font-bold">Notifications</h3>
        <label className="mt-3 flex items-center justify-between">
          <span>Sound for help &amp; reactions</span>
          <input type="checkbox" className="h-5 w-5 accent-[#C8102E]" checked={!!profile.notificationSound} onChange={(e) => updateMyProfile({ notificationSound: e.target.checked })} />
        </label>
      </Card>
      <Card>
        <h3 className="font-bold">Account</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" onClick={async () => { await signOut(); router.replace('/login'); }}>Sign out</Button>
          <Button variant="danger" onClick={() => setOpen(true)}>Delete profile</Button>
        </div>
      </Card>
      <Card>
        <h3 className="font-bold">About</h3>
        <p className="text-sm text-muted">Canact v1.0 — community-first, mobile-first.</p>
      </Card>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} title="Delete profile?" message="Your account and data will be permanently removed." confirmLabel="Delete" danger
        onConfirm={async () => {
          try {
            await deleteAccount();
            router.replace('/login');
          } catch (e: any) { toast(e?.message ?? 'Could not delete', 'error'); }
        }}
      />
    </div>
  );
}

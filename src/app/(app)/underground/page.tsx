'use client';
import { useEffect, useState } from 'react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { useAuth } from '@/lib/auth';
import { exitUnderground, extendUnderground, goUnderground } from '@/lib/services/underground';
import { timeLeft } from '@/lib/utils';
import { ConfirmDialog } from '@/components/Modal';
import { toast } from '@/components/Toaster';

export default function UndergroundPage() {
  const { user, profile } = useAuth();
  const [, force] = useState(0);
  const [confirmOpen, setConfirm] = useState(false);
  const [extending, setExtending] = useState(false);
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  if (!user || !profile) return null;
  const active = profile.underground && (profile.undergroundUntil ?? 0) > Date.now();
  const canExtend = active && !profile.undergroundExtendedAt;
  const handleExtend = async () => {
    if (!canExtend || extending) return;
    setExtending(true);
    try {
      const extended = await extendUnderground(user.uid);
      toast(extended ? 'Underground extended by 4 hours.' : 'This session was already extended.', extended ? 'success' : 'error');
    } finally {
      setExtending(false);
    }
  };
  return (
    <div className="px-4 pt-4">
      <Card className={active ? 'bg-underground text-white border-black' : ''}>
        <h2 className={`text-2xl font-extrabold ${active ? 'text-white' : 'text-ink'}`}>Underground</h2>
        <p className={`mt-1 text-sm ${active ? 'text-white/70' : 'text-muted'}`}>
          Hide your profile from the leaderboard temporarily. Your rating reduces a little each time, growing with each same-day usage.
        </p>
        {active ? (
          <>
            <p className={`mt-3 text-lg font-bold ${active ? 'text-white' : 'text-ink'}`}>{timeLeft(profile.undergroundUntil ?? 0)}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="subtle" disabled={!canExtend || extending} onClick={handleExtend}>
                {canExtend ? (extending ? 'Extending…' : 'Extend +4h once') : 'Extension used'}
              </Button>
              <Button onClick={() => exitUnderground(user.uid)}>Exit underground</Button>
            </div>
          </>
        ) : (
          <Button variant="danger" className="mt-4" onClick={() => setConfirm(true)}>Go underground for 4 hours</Button>
        )}
        <ConfirmDialog open={confirmOpen} onClose={() => setConfirm(false)}
          onConfirm={() => goUnderground(user.uid, 4)}
          title="Go underground?"
          message="Your rating will reduce slightly. The reduction grows the more times you go underground in a single day."
          confirmLabel="Go underground"
          danger
        />
      </Card>
    </div>
  );
}

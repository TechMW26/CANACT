'use client';

import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { toast } from '@/components/Toaster';
import { useAuth } from '@/lib/auth';
import { getFirebaseAuth } from '@/lib/firebase';

type BackupItem = {
  id: string;
  name: string;
  size: number;
  contentType: string;
  createdAt: number;
  access: 'public' | 'private';
  downloadPath: string;
};

type BackupUser = {
  uid: string;
  user: {
    uid: string;
    fullName: string;
    email: string | null;
    mobile: string | null;
    city: string | null;
    country: string | null;
    photoURL: string | null;
    createdAt: number | null;
  };
  itemCount: number;
  totalBytes: number;
  latestBackupAt: number;
  items: BackupItem[];
};

type BackupResponse = {
  ok: boolean;
  reason?: string;
  fetchedAt?: number;
  totals?: { users: number; files: number; bytes: number };
  users?: BackupUser[];
};

export default function AdminDashboardPage() {
  const { user, loading } = useAuth();
  const [data, setData] = useState<BackupResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const refresh = async () => {
    setBusy(true);
    try {
      const token = await getFirebaseAuth().currentUser?.getIdToken();
      if (!token) throw new Error('Not signed in');
      const res = await fetch('/api/admin/backups', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const json = (await res.json()) as BackupResponse;
      if (!res.ok || !json.ok) throw new Error(json.reason || 'Could not load admin data');
      setData(json);
      setSelectedUid((current) => current ?? json.users?.[0]?.uid ?? null);
    } catch (error: any) {
      setData({ ok: false, reason: error?.message ?? 'Could not load admin data' });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (loading || !user) return;
    refresh();
  }, [loading, user?.uid]);

  const users = data?.users ?? [];
  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((row) => {
      const haystack = [row.user.fullName, row.user.email, row.user.mobile, row.uid, row.user.city, row.user.country]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [query, users]);
  const selected = filteredUsers.find((row) => row.uid === selectedUid) ?? filteredUsers[0] ?? null;

  const downloadItem = async (owner: BackupUser, item: BackupItem) => {
    setDownloadingId(item.id);
    try {
      const token = await getFirebaseAuth().currentUser?.getIdToken();
      if (!token) throw new Error('Not signed in');
      const res = await fetch(item.downloadPath, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = item.name || `${owner.uid}-${item.id}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (error: any) {
      toast(error?.message ?? 'Download failed', 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading || !user) return null;

  return (
    <div className="space-y-4 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">Admin dashboard</h1>
          <p className="text-sm text-ink/60">Browse user-wise cloud backups and download files through an admin-verified API.</p>
        </div>
        <Button onClick={refresh} loading={busy}>Refresh</Button>
      </div>

      {data?.ok === false && (
        <Card className="border-brand-light bg-brand-light/60 text-brand">
          <div className="font-extrabold">Admin access unavailable</div>
          <p className="mt-1 text-sm">{data.reason === 'unauthorized' ? 'Your signed-in account is not configured as an admin.' : data.reason}</p>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Users with backups" value={data?.totals?.users ?? 0} />
        <MetricCard label="Backed up files" value={data?.totals?.files ?? 0} />
        <MetricCard label="Storage tracked" value={formatBytes(data?.totals?.bytes ?? 0)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="space-y-3">
          <div>
            <h2 className="font-extrabold text-ink">Users</h2>
            <p className="text-xs text-ink/55">Only users with backup records are shown.</p>
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, email, phone, uid"
            className="h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm outline-none focus:border-brand"
          />
          <div className="max-h-[60vh] space-y-2 overflow-auto pr-1">
            {filteredUsers.map((row) => {
              const active = selected?.uid === row.uid;
              return (
                <button
                  key={row.uid}
                  type="button"
                  onClick={() => setSelectedUid(row.uid)}
                  className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${active ? 'border-brand bg-brand-light' : 'border-line bg-white hover:bg-brand-light/50'}`}
                >
                  <Avatar src={row.user.photoURL} name={row.user.fullName} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-extrabold text-ink">{row.user.fullName}</span>
                    <span className="block truncate text-xs text-ink/55">{row.user.email || row.uid}</span>
                    <span className="mt-1 block text-xs font-bold text-ink/70">{row.itemCount} files · {formatBytes(row.totalBytes)}</span>
                  </span>
                </button>
              );
            })}
            {!filteredUsers.length && <p className="rounded-2xl bg-white p-4 text-sm text-ink/60">No backup records found.</p>}
          </div>
        </Card>

        <Card className="space-y-4">
          {selected ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar src={selected.user.photoURL} name={selected.user.fullName} size={52} />
                  <div className="min-w-0">
                    <h2 className="truncate text-xl font-extrabold text-ink">{selected.user.fullName}</h2>
                    <p className="truncate text-sm text-ink/60">{selected.user.email || selected.uid}</p>
                    <p className="text-xs text-ink/50">{[selected.user.city, selected.user.country].filter(Boolean).join(', ') || 'No location on profile'}</p>
                  </div>
                </div>
                <div className="text-right text-xs text-ink/55">
                  <div className="font-extrabold text-ink">{selected.itemCount} files</div>
                  <div>{formatBytes(selected.totalBytes)}</div>
                  <div>Latest {formatDate(selected.latestBackupAt)}</div>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-line">
                <div className="grid grid-cols-[minmax(0,1fr)_92px_132px_112px] gap-3 bg-white px-3 py-2 text-xs font-extrabold text-ink/60">
                  <span>File</span>
                  <span>Size</span>
                  <span>Uploaded</span>
                  <span className="text-right">Action</span>
                </div>
                <div className="divide-y divide-line bg-surface">
                  {selected.items.map((item) => (
                    <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_92px_132px_112px] items-center gap-3 px-3 py-3 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-bold text-ink">{item.name}</div>
                        <div className="truncate text-xs text-ink/50">{item.contentType}</div>
                      </div>
                      <div className="text-xs text-ink/60">{formatBytes(item.size)}</div>
                      <div className="text-xs text-ink/60">{formatDate(item.createdAt)}</div>
                      <div className="text-right">
                        <Button size="sm" variant="outline" loading={downloadingId === item.id} onClick={() => downloadItem(selected, item)}>Download</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="py-16 text-center text-sm text-ink/60">Select a user to view backed up files.</div>
          )}
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <div className="text-xs font-extrabold uppercase text-ink/45">{label}</div>
      <div className="mt-1 text-2xl font-extrabold text-ink">{value}</div>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value: number): string {
  if (!value) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
'use client';

import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Brand } from '@/components/Brand';
import { Splash } from '@/components/Splash';
import { toast } from '@/components/Toaster';
import { BarChart3, CloudUpload, Search, ShieldAlert, Users, Globe2, Clock, Mail, Phone, MapPin } from '@/components/icons';
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
    profileComplete: boolean | null;
    profileVerified: boolean | null;
    rating: number | null;
    ratingCount: number | null;
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
  totals?: { users: number; usersWithBackups: number; files: number; bytes: number };
  users?: BackupUser[];
};

type AdminView = 'overview' | 'backups' | 'users' | 'analytics';
type BackupItemWithOwner = BackupItem & { owner: BackupUser };

const ADMIN_VIEWS: Array<{ id: AdminView; label: string; description: string; Icon: LucideIcon }> = [
  { id: 'overview', label: 'Overview', description: 'Command center', Icon: ShieldAlert },
  { id: 'backups', label: 'User backups', description: 'Files by account', Icon: CloudUpload },
  { id: 'users', label: 'Users', description: 'Profiles and status', Icon: Users },
  { id: 'analytics', label: 'Analytics', description: 'Storage and growth', Icon: BarChart3 },
];

export default function AdminDashboardPage() {
  const { user, loading } = useAuth();
  const [activeView, setActiveView] = useState<AdminView>('overview');
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
    if (loading) return;
    if (!user) {
      window.location.replace('/welcome');
      return;
    }
    refresh();
  }, [loading, user?.uid]);

  const users = data?.users ?? [];
  const totals = data?.totals ?? { users: users.length, usersWithBackups: 0, files: 0, bytes: 0 };
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
  const selected = filteredUsers.find((row) => row.uid === selectedUid) ?? filteredUsers[0] ?? users[0] ?? null;
  const allItems = useMemo<BackupItemWithOwner[]>(() => {
    return users.flatMap((owner) => owner.items.map((item) => ({ ...item, owner })));
  }, [users]);
  const analytics = useMemo(() => buildAnalytics(users, allItems), [users, allItems]);

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

  if (loading) return <Splash message="Loading admin..." />;
  if (!user) return null;

  const activeMeta = ADMIN_VIEWS.find((view) => view.id === activeView) ?? ADMIN_VIEWS[0];

  return (
    <main className="relative left-1/2 min-h-[var(--canact-viewport-height)] w-screen -translate-x-1/2 bg-[#F7F4EF] text-ink">
      <div className="min-h-[var(--canact-viewport-height)] w-full">
        <aside className="fixed inset-y-0 left-0 z-30 flex h-[var(--canact-viewport-height)] w-[240px] flex-col border-r border-[#E8DDD4] bg-[#201A17] text-white lg:w-[280px]">
          <div className="flex h-full flex-col gap-5 overflow-y-auto p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <Brand size={34} href="/admin" />
              <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide text-white/70">CRM</span>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="text-xs font-bold uppercase text-white/50">Signed in</div>
              <div className="mt-1 truncate text-sm font-extrabold">{user.email}</div>
            </div>

            <nav className="grid gap-2">
              {ADMIN_VIEWS.map(({ id, label, description, Icon }) => {
                const active = activeView === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveView(id)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-3 text-left transition ${active ? 'bg-brand text-white shadow-lg shadow-brand/20' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-extrabold">{label}</span>
                      <span className={`block truncate text-xs ${active ? 'text-white/75' : 'text-white/40'}`}>{description}</span>
                    </span>
                  </button>
                );
              })}
            </nav>

            <div className="mt-auto rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/60">
              <div className="font-extrabold text-white">Private admin URL</div>
              <p className="mt-1">This dashboard is separate from the app interface and is accessed directly at /admin.</p>
            </div>
          </div>
        </aside>

        <section className="ml-[240px] min-w-0 pt-[120px] lg:ml-[280px] lg:pt-[124px]">
          <header className="fixed left-[240px] right-0 top-0 z-20 border-b border-[#E8DDD4] bg-[#F7F4EF]/95 px-4 py-4 backdrop-blur sm:px-6 lg:left-[280px] lg:px-8">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="text-xs font-extrabold uppercase tracking-wide text-brand">Canact admin</div>
                <h1 className="mt-1 text-3xl font-extrabold text-ink sm:text-4xl">{activeMeta.label}</h1>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <label className="relative block min-w-0 sm:w-[360px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search users, emails, phone, UID"
                    className="h-11 w-full rounded-lg border border-[#E0D4CA] bg-white pl-9 pr-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
                  />
                </label>
                <Button onClick={refresh} loading={busy}>Refresh</Button>
              </div>
            </div>
          </header>

          <div className="space-y-6 px-4 py-5 sm:px-6 lg:px-8">
            {data?.ok === false && (
              <Card className="rounded-lg border-brand-light bg-brand-light/60 text-brand">
                <div className="font-extrabold">Admin access unavailable</div>
                <p className="mt-1 text-sm">{data.reason === 'unauthorized' ? 'Your signed-in account is not configured as an admin.' : data.reason}</p>
              </Card>
            )}

            {activeView === 'overview' && (
              <OverviewPage
                totals={totals}
                users={users}
                latestItems={analytics.latestItems}
                storageLeaders={analytics.storageLeaders}
                completionRate={analytics.completionRate}
                backupCoverage={analytics.backupCoverage}
                verifiedRate={analytics.verifiedRate}
                onOpenBackups={() => setActiveView('backups')}
              />
            )}

            {activeView === 'backups' && (
              <BackupsPage
                users={filteredUsers}
                selected={selected}
                selectedUid={selectedUid}
                setSelectedUid={setSelectedUid}
                downloadItem={downloadItem}
                downloadingId={downloadingId}
              />
            )}

            {activeView === 'users' && <UsersPage users={filteredUsers} setActiveView={setActiveView} setSelectedUid={setSelectedUid} />}

            {activeView === 'analytics' && <AnalyticsPage analytics={analytics} totals={totals} />}
          </div>
        </section>
      </div>
    </main>
  );
}

function OverviewPage({
  totals,
  users,
  latestItems,
  storageLeaders,
  completionRate,
  backupCoverage,
  verifiedRate,
  onOpenBackups,
}: {
  totals: NonNullable<BackupResponse['totals']>;
  users: BackupUser[];
  latestItems: BackupItemWithOwner[];
  storageLeaders: BackupUser[];
  completionRate: number;
  backupCoverage: number;
  verifiedRate: number;
  onOpenBackups: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total users" value={totals.users} detail={`${formatPercent(completionRate)} profile completion`} Icon={Users} />
        <MetricCard label="Backup users" value={totals.usersWithBackups} detail={`${formatPercent(backupCoverage)} of accounts`} Icon={CloudUpload} />
        <MetricCard label="Backed up files" value={totals.files} detail={`${latestItems.length} recent files indexed`} Icon={Clock} />
        <MetricCard label="Storage tracked" value={formatBytes(totals.bytes)} detail={`${formatPercent(verifiedRate)} verified users`} Icon={BarChart3} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <Card className="rounded-lg bg-white">
          <SectionHeader title="Recent backup activity" eyebrow="Operations" action={<Button variant="outline" size="sm" onClick={onOpenBackups}>Open backups</Button>} />
          <div className="mt-4 divide-y divide-line">
            {latestItems.slice(0, 8).map((item) => (
              <div key={`${item.owner.uid}-${item.id}`} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_110px_150px] sm:items-center">
                <div className="min-w-0">
                  <div className="truncate text-sm font-extrabold text-ink">{item.name}</div>
                  <div className="truncate text-xs text-ink/60">{item.owner.user.fullName} / {item.contentType}</div>
                </div>
                <div className="text-xs font-bold text-ink/60">{formatBytes(item.size)}</div>
                <div className="text-xs text-ink/60">{formatDate(item.createdAt)}</div>
              </div>
            ))}
            {!latestItems.length && <EmptyState title="No backups yet" detail="Backed up media will appear here as users opt in and upload." />}
          </div>
        </Card>

        <Card className="rounded-lg bg-[#201A17] text-white">
          <SectionHeader title="Account readiness" eyebrow="Health" dark />
          <div className="mt-5 space-y-4">
            <ProgressRow label="Backup coverage" value={backupCoverage} dark />
            <ProgressRow label="Profile completion" value={completionRate} dark />
            <ProgressRow label="Verified profiles" value={verifiedRate} dark />
          </div>
          <div className="mt-6 rounded-lg border border-white/10 bg-white/5 p-4">
            <div className="text-xs font-bold uppercase text-white/50">Audience</div>
            <div className="mt-1 text-3xl font-extrabold">{users.length}</div>
            <div className="text-sm text-white/60">registered accounts tracked in the admin console</div>
          </div>
        </Card>
      </div>

      <Card className="rounded-lg bg-white">
        <SectionHeader title="Top storage accounts" eyebrow="Storage" />
        <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {storageLeaders.map((row) => (
            <div key={row.uid} className="rounded-lg border border-line p-3">
              <div className="flex items-center gap-3">
                <Avatar src={row.user.photoURL} name={row.user.fullName} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-extrabold text-ink">{row.user.fullName}</div>
                  <div className="truncate text-xs text-ink/60">{row.user.email || row.uid}</div>
                </div>
                <div className="text-right text-sm font-extrabold text-brand">{formatBytes(row.totalBytes)}</div>
              </div>
            </div>
          ))}
          {!storageLeaders.length && <EmptyState title="No storage leaders" detail="Users with backups will be ranked here." />}
        </div>
      </Card>
    </div>
  );
}

function BackupsPage({
  users,
  selected,
  selectedUid,
  setSelectedUid,
  downloadItem,
  downloadingId,
}: {
  users: BackupUser[];
  selected: BackupUser | null;
  selectedUid: string | null;
  setSelectedUid: (uid: string) => void;
  downloadItem: (owner: BackupUser, item: BackupItem) => void;
  downloadingId: string | null;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)] 2xl:grid-cols-[440px_minmax(0,1fr)]">
      <Card className="rounded-lg bg-white">
        <SectionHeader title="User backup data" eyebrow="Files" />
        <div className="mt-4 grid max-h-[calc(var(--canact-viewport-height)-220px)] grid-cols-1 gap-2 overflow-auto pr-1 md:grid-cols-2 xl:grid-cols-1">
          {users.map((row) => {
            const active = (selected?.uid ?? selectedUid) === row.uid;
            return <UserBackupCard key={row.uid} row={row} active={active} onClick={() => setSelectedUid(row.uid)} />;
          })}
          {!users.length && <EmptyState title="No users found" detail="Try another search term." />}
        </div>
      </Card>

      <Card className="min-h-[640px] rounded-lg bg-white">
        {selected ? (
          <SelectedUserPanel selected={selected} downloadItem={downloadItem} downloadingId={downloadingId} />
        ) : (
          <EmptyState title="Select a user" detail="Choose any user to view profile data and backed up files." />
        )}
      </Card>
    </div>
  );
}

function UsersPage({
  users,
  setActiveView,
  setSelectedUid,
}: {
  users: BackupUser[];
  setActiveView: (view: AdminView) => void;
  setSelectedUid: (uid: string) => void;
}) {
  return (
    <Card className="rounded-lg bg-white">
      <SectionHeader title="Users" eyebrow="Directory" />
      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[860px] divide-y divide-line">
          <div className="grid grid-cols-[minmax(240px,1fr)_150px_150px_120px_130px_110px] gap-3 px-3 py-2 text-xs font-extrabold uppercase text-ink/50">
            <span>User</span>
            <span>Phone</span>
            <span>Location</span>
            <span>Status</span>
            <span>Backup</span>
            <span className="text-right">Action</span>
          </div>
          {users.map((row) => (
            <div key={row.uid} className="grid grid-cols-[minmax(240px,1fr)_150px_150px_120px_130px_110px] items-center gap-3 px-3 py-3 text-sm">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar src={row.user.photoURL} name={row.user.fullName} size={38} />
                <div className="min-w-0">
                  <div className="truncate font-extrabold text-ink">{row.user.fullName}</div>
                  <div className="truncate text-xs text-ink/60">{row.user.email || row.uid}</div>
                </div>
              </div>
              <span className="truncate text-ink/60">{row.user.mobile || 'Not set'}</span>
              <span className="truncate text-ink/60">{[row.user.city, row.user.country].filter(Boolean).join(', ') || 'Not set'}</span>
              <StatusPill tone={row.user.profileVerified ? 'green' : row.user.profileComplete ? 'amber' : 'gray'}>
                {row.user.profileVerified ? 'Verified' : row.user.profileComplete ? 'Complete' : 'Incomplete'}
              </StatusPill>
              <span className="font-bold text-ink/70">{row.itemCount} files / {formatBytes(row.totalBytes)}</span>
              <div className="text-right">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSelectedUid(row.uid);
                    setActiveView('backups');
                  }}
                >
                  View
                </Button>
              </div>
            </div>
          ))}
          {!users.length && <EmptyState title="No users found" detail="Try another search term." />}
        </div>
      </div>
    </Card>
  );
}

function AnalyticsPage({ analytics, totals }: { analytics: ReturnType<typeof buildAnalytics>; totals: NonNullable<BackupResponse['totals']> }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Backup coverage" value={formatPercent(analytics.backupCoverage)} detail={`${totals.usersWithBackups} of ${totals.users} users`} Icon={CloudUpload} />
        <MetricCard label="Avg files per backup user" value={analytics.averageFilesPerBackupUser.toFixed(1)} detail={`${totals.files} files total`} Icon={BarChart3} />
        <MetricCard label="Avg storage per backup user" value={formatBytes(analytics.averageBytesPerBackupUser)} detail={`${formatBytes(totals.bytes)} total`} Icon={Users} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="rounded-lg bg-white">
          <SectionHeader title="Storage by user" eyebrow="Analytics" />
          <div className="mt-5 space-y-4">
            {analytics.storageLeaders.map((row) => (
              <ProgressRow key={row.uid} label={row.user.fullName} sublabel={formatBytes(row.totalBytes)} value={percentOf(row.totalBytes, analytics.maxUserBytes)} />
            ))}
            {!analytics.storageLeaders.length && <EmptyState title="No storage data" detail="Backup uploads will create this chart." />}
          </div>
        </Card>

        <Card className="rounded-lg bg-white">
          <SectionHeader title="File type mix" eyebrow="Analytics" />
          <div className="mt-5 space-y-4">
            {analytics.fileTypes.map((row) => (
              <ProgressRow key={row.label} label={row.label} sublabel={`${row.count} files`} value={percentOf(row.count, analytics.maxTypeCount)} />
            ))}
            {!analytics.fileTypes.length && <EmptyState title="No file types yet" detail="Photo and video backup types will be grouped here." />}
          </div>
        </Card>

        <Card className="rounded-lg bg-white xl:col-span-2">
          <SectionHeader title="Geography" eyebrow="Users" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {analytics.countryCounts.map((row) => (
              <div key={row.label} className="rounded-lg border border-line p-4">
                <div className="flex items-center gap-2 text-xs font-extrabold uppercase text-ink/50">
                  <Globe2 className="h-4 w-4" />
                  Country
                </div>
                <div className="mt-2 text-lg font-extrabold text-ink">{row.label}</div>
                <div className="text-sm text-ink/60">{row.count} users</div>
              </div>
            ))}
            {!analytics.countryCounts.length && <EmptyState title="No locations yet" detail="User profile countries will appear here." />}
          </div>
        </Card>
      </div>
    </div>
  );
}

function SelectedUserPanel({ selected, downloadItem, downloadingId }: { selected: BackupUser; downloadItem: (owner: BackupUser, item: BackupItem) => void; downloadingId: string | null }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar src={selected.user.photoURL} name={selected.user.fullName} size={64} />
          <div className="min-w-0">
            <h2 className="truncate text-3xl font-extrabold text-ink">{selected.user.fullName}</h2>
            <p className="truncate text-sm text-ink/60">{selected.user.email || selected.uid}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusPill tone={selected.user.profileVerified ? 'green' : 'amber'}>{selected.user.profileVerified ? 'Verified' : 'Unverified'}</StatusPill>
              <StatusPill tone={selected.itemCount ? 'green' : 'gray'}>{selected.itemCount ? 'Backup active' : 'No backups'}</StatusPill>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-line p-3 text-right">
          <div className="text-2xl font-extrabold text-ink">{selected.itemCount}</div>
          <div className="text-xs text-ink/60">files / {formatBytes(selected.totalBytes)}</div>
          <div className="text-xs text-ink/60">Latest {formatDate(selected.latestBackupAt)}</div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        <ProfileField icon={Mail} label="Email" value={selected.user.email || 'Not set'} />
        <ProfileField icon={Phone} label="Mobile" value={selected.user.mobile || 'Not set'} />
        <ProfileField icon={MapPin} label="Location" value={[selected.user.city, selected.user.country].filter(Boolean).join(', ') || 'Not set'} />
        <ProfileField icon={Clock} label="Joined" value={formatDate(selected.user.createdAt ?? 0)} />
        <ProfileField icon={Users} label="UID" value={selected.uid} />
        <ProfileField icon={ShieldAlert} label="Profile" value={selected.user.profileComplete ? 'Complete' : 'Incomplete'} />
        <ProfileField icon={BarChart3} label="Rating" value={selected.user.rating === null ? 'Not rated' : `${selected.user.rating.toFixed(1)} (${selected.user.ratingCount ?? 0})`} />
        <ProfileField icon={CloudUpload} label="Storage" value={formatBytes(selected.totalBytes)} />
      </div>

      <BackupFileTable selected={selected} downloadItem={downloadItem} downloadingId={downloadingId} />
    </div>
  );
}

function BackupFileTable({ selected, downloadItem, downloadingId }: { selected: BackupUser; downloadItem: (owner: BackupUser, item: BackupItem) => void; downloadingId: string | null }) {
  return (
    <div>
      <SectionHeader title="Backed up files" eyebrow="Private storage" />
      <div className="mt-3 overflow-x-auto rounded-lg border border-line">
        <div className="min-w-[720px] divide-y divide-line bg-white">
          <div className="grid grid-cols-[minmax(260px,1fr)_110px_160px_120px] gap-3 px-3 py-2 text-xs font-extrabold uppercase text-ink/50">
            <span>File</span>
            <span>Size</span>
            <span>Uploaded</span>
            <span className="text-right">Action</span>
          </div>
          {selected.items.map((item) => (
            <div key={item.id} className="grid grid-cols-[minmax(260px,1fr)_110px_160px_120px] items-center gap-3 px-3 py-3 text-sm">
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
          {!selected.items.length && <EmptyState title="No files backed up" detail="This user has not backed up any files yet." />}
        </div>
      </div>
    </div>
  );
}

function UserBackupCard({ row, active, onClick }: { row: BackupUser; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border p-3 text-left transition ${active ? 'border-brand bg-brand-light' : 'border-line bg-white hover:border-brand/40 hover:bg-[#FAF8F2]'}`}
    >
      <div className="flex items-start gap-3">
        <Avatar src={row.user.photoURL} name={row.user.fullName} size={42} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-extrabold text-ink">{row.user.fullName}</div>
          <div className="truncate text-xs text-ink/60">{row.user.email || row.uid}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <StatusPill tone={row.itemCount ? 'green' : 'gray'}>{row.itemCount} files</StatusPill>
            <StatusPill tone="gray">{formatBytes(row.totalBytes)}</StatusPill>
          </div>
        </div>
      </div>
    </button>
  );
}

function MetricCard({ label, value, detail, Icon }: { label: string; value: string | number; detail: string; Icon: LucideIcon }) {
  return (
    <Card className="rounded-lg bg-white">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-extrabold uppercase text-ink/50">{label}</div>
          <div className="mt-2 text-3xl font-extrabold text-ink">{value}</div>
          <div className="mt-1 text-sm text-ink/60">{detail}</div>
        </div>
        <div className="rounded-lg bg-brand-light p-2 text-brand">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

function SectionHeader({ title, eyebrow, action, dark }: { title: string; eyebrow: string; action?: React.ReactNode; dark?: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className={`text-xs font-extrabold uppercase tracking-wide ${dark ? 'text-white/50' : 'text-brand'}`}>{eyebrow}</div>
        <h2 className={`mt-1 text-xl font-extrabold ${dark ? 'text-white' : 'text-ink'}`}>{title}</h2>
      </div>
      {action}
    </div>
  );
}

function ProfileField({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-white p-3">
      <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase text-ink/50">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2 truncate text-sm font-bold text-ink">{value}</div>
    </div>
  );
}

function ProgressRow({ label, value, sublabel, dark }: { label: string; value: number; sublabel?: string; dark?: boolean }) {
  const normalized = clampPercent(value);
  return (
    <div>
      <div className={`mb-2 flex items-center justify-between gap-3 text-sm ${dark ? 'text-white/75' : 'text-ink/70'}`}>
        <span className="truncate font-bold">{label}</span>
        <span className="shrink-0 text-xs font-extrabold">{sublabel ?? formatPercent(normalized)}</span>
      </div>
      <div className={`h-2 overflow-hidden rounded-full ${dark ? 'bg-white/10' : 'bg-[#EFE5DE]'}`}>
        <div className="h-full rounded-full bg-brand" style={{ width: `${normalized}%` }} />
      </div>
    </div>
  );
}

function StatusPill({ children, tone }: { children: React.ReactNode; tone: 'green' | 'amber' | 'gray' }) {
  const tones = {
    green: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    gray: 'bg-ink/5 text-ink/60',
  };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-extrabold ${tones[tone]}`}>{children}</span>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-white/60 p-5 text-center">
      <div className="text-sm font-extrabold text-ink">{title}</div>
      <div className="mt-1 text-xs text-ink/60">{detail}</div>
    </div>
  );
}

function buildAnalytics(users: BackupUser[], allItems: BackupItemWithOwner[]) {
  const latestItems = [...allItems].sort((a, b) => b.createdAt - a.createdAt);
  const storageLeaders = [...users]
    .filter((row) => row.totalBytes > 0 || row.itemCount > 0)
    .sort((a, b) => b.totalBytes - a.totalBytes)
    .slice(0, 8);
  const maxUserBytes = Math.max(...storageLeaders.map((row) => row.totalBytes), 0);
  const usersWithBackups = users.filter((row) => row.itemCount > 0).length;
  const completedUsers = users.filter((row) => row.user.profileComplete).length;
  const verifiedUsers = users.filter((row) => row.user.profileVerified).length;
  const fileTypeCounts = countBy(allItems, (item) => item.contentType.split('/')[0] || 'unknown');
  const countryCounts = countBy(users, (row) => row.user.country || 'Not set');
  const fileTypes = Object.entries(fileTypeCounts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
  return {
    latestItems,
    storageLeaders,
    maxUserBytes,
    fileTypes,
    maxTypeCount: Math.max(...fileTypes.map((row) => row.count), 0),
    countryCounts: Object.entries(countryCounts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    backupCoverage: percentOf(usersWithBackups, users.length),
    completionRate: percentOf(completedUsers, users.length),
    verifiedRate: percentOf(verifiedUsers, users.length),
    averageFilesPerBackupUser: usersWithBackups ? allItems.length / usersWithBackups : 0,
    averageBytesPerBackupUser: usersWithBackups ? users.reduce((sum, row) => sum + row.totalBytes, 0) / usersWithBackups : 0,
  };
}

function countBy<T>(items: T[], getKey: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = getKey(item).trim() || 'Unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function percentOf(value: number, total: number): number {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function formatPercent(value: number): string {
  return `${clampPercent(value)}%`;
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
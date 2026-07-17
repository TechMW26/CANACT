'use client';

import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { onValue, ref as dbRef, set as dbSet } from 'firebase/database';
import { db } from '@/lib/firebase';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Brand } from '@/components/Brand';
import { Splash } from '@/components/Splash';
import { toast } from '@/components/Toaster';
import { BarChart3, Bell, Camera, Compass, Eye, Film, HandHeart, Heart, AlignLeft, MessageSquare, Plus, Search, ShieldAlert, Sparkles, Trophy, Users, Globe2, Clock, Mail, Phone, MapPin, Check, Home, MapPin as MapPinIcon, Grid3X3, Activity, Pencil, TrendingUp, Navigation, Zap } from '@/components/icons';
import { useAuth } from '@/lib/auth';
import { getFirebaseAuth } from '@/lib/firebase';

// ── Heatzones types ──

type HeatzoneResponse = {
  ok: boolean;
  reason?: string;
  fetchedAt?: number;
  totals?: { pageViews: number; featureClicks: number; uniquePages: number };
  pageLeaderboard?: Array<{ pageId: string; views: number }>;
  pageHeatmaps?: Array<{ pageId: string; views: number; jumps: Array<{ from: string; count: number; pct: number }> }>;
  featureLeaderboard?: Record<string, Array<{ featureId: string; clicks: number }>>;
};

type HeatAccumulators = {
  pages: Record<string, number>;
  from: Record<string, Record<string, number>>;
  features: Record<string, Record<string, number>>;
};

function emptyHeatAccumulators(): HeatAccumulators {
  return { pages: {}, from: {}, features: {} };
}

function buildHeatzoneResponse(acc: HeatAccumulators): HeatzoneResponse {
  const pageLeaderboard = Object.entries(acc.pages)
    .map(([pageId, views]) => ({ pageId, views }))
    .sort((a, b) => b.views - a.views);
  const pageHeatmaps = pageLeaderboard.map(({ pageId, views }) => ({
    pageId,
    views,
    jumps: Object.entries(acc.from[pageId] ?? {})
      .map(([from, count]) => ({ from, count, pct: views ? Math.round((count / views) * 100) : 0 }))
      .sort((a, b) => b.count - a.count),
  }));
  const featureLeaderboard = Object.fromEntries(
    Object.entries(acc.features).map(([pageId, features]) => [
      pageId,
      Object.entries(features)
        .map(([featureId, clicks]) => ({ featureId, clicks }))
        .sort((a, b) => b.clicks - a.clicks),
    ]),
  );
  return {
    ok: true,
    fetchedAt: Date.now(),
    totals: {
      pageViews: Object.values(acc.pages).reduce((sum, value) => sum + value, 0),
      featureClicks: Object.values(acc.features).reduce(
        (sum, features) => sum + Object.values(features).reduce((featureSum, value) => featureSum + value, 0),
        0,
      ),
      uniquePages: pageLeaderboard.length,
    },
    pageLeaderboard,
    pageHeatmaps,
    featureLeaderboard,
  };
}

function aggregateRealtimeHeatzones(users: Record<string, any> | null): HeatzoneResponse {
  const acc = emptyHeatAccumulators();
  for (const user of Object.values(users ?? {})) {
    const analytics = user?.analytics ?? {};
    for (const pages of Object.values(analytics.pageViews ?? {}) as Record<string, any>[]) {
      for (const record of Object.values(pages ?? {}) as any[]) {
        const pageId = String(record?.pageId || 'Unknown');
        const count = Number(record?.count) || 0;
        acc.pages[pageId] = (acc.pages[pageId] ?? 0) + count;
        acc.from[pageId] ??= {};
        for (const [encodedFrom, fromCount] of Object.entries(record?.fromCounts ?? {})) {
          let from = encodedFrom;
          try { from = decodeURIComponent(encodedFrom); } catch {}
          acc.from[pageId][from] = (acc.from[pageId][from] ?? 0) + (Number(fromCount) || 0);
        }
      }
    }
    for (const pages of Object.values(analytics.featureClicks ?? {}) as Record<string, any>[]) {
      for (const features of Object.values(pages ?? {}) as Record<string, any>[]) {
        for (const record of Object.values(features ?? {}) as any[]) {
          const pageId = String(record?.pageId || 'Unknown');
          const featureId = String(record?.featureId || 'Unknown');
          acc.features[pageId] ??= {};
          acc.features[pageId][featureId] = (acc.features[pageId][featureId] ?? 0) + (Number(record?.count) || 0);
        }
      }
    }
  }
  return buildHeatzoneResponse(acc);
}

function mergeHeatzoneResponses(legacy: HeatzoneResponse | null, realtime: HeatzoneResponse): HeatzoneResponse {
  if (!legacy?.ok) return realtime;
  const acc = emptyHeatAccumulators();
  for (const source of [legacy, realtime]) {
    for (const page of source.pageLeaderboard ?? []) {
      acc.pages[page.pageId] = (acc.pages[page.pageId] ?? 0) + page.views;
    }
    for (const page of source.pageHeatmaps ?? []) {
      acc.from[page.pageId] ??= {};
      for (const jump of page.jumps) {
        acc.from[page.pageId][jump.from] = (acc.from[page.pageId][jump.from] ?? 0) + jump.count;
      }
    }
    for (const [pageId, features] of Object.entries(source.featureLeaderboard ?? {})) {
      acc.features[pageId] ??= {};
      for (const feature of features) {
        acc.features[pageId][feature.featureId] = (acc.features[pageId][feature.featureId] ?? 0) + feature.clicks;
      }
    }
  }
  return buildHeatzoneResponse(acc);
}

type AdminView = 'overview' | 'users' | 'heatzones' | 'navigation';

const ADMIN_VIEWS: Array<{ id: AdminView; label: string; description: string; Icon: LucideIcon }> = [
  { id: 'overview', label: 'Overview', description: 'Command center', Icon: ShieldAlert },
  { id: 'users', label: 'Users', description: 'Profiles and status', Icon: Users },
  { id: 'heatzones', label: 'Heatzones', description: 'Page & feature analytics', Icon: TrendingUp },
  { id: 'navigation', label: 'Navigation', description: 'App navbar config', Icon: Compass },
];

export default function AdminDashboardPage() {
  const { user, loading } = useAuth();
  const [activeView, setActiveView] = useState<AdminView>('overview');
  const [heatData, setHeatData] = useState<HeatzoneResponse | null>(null);
  const [heatBusy, setHeatBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedPage, setSelectedPage] = useState<string | null>(null);

  // ── Users live listener (kept from original) ──
  const [usersSnapshot, setUsersSnapshot] = useState<Record<string, any> | null>(null);
  useEffect(() => {
    return onValue(dbRef(db, 'users'), (snap) => setUsersSnapshot(snap.val() ?? {}));
  }, []);

  const fetchHeatzones = async () => {
    setHeatBusy(true);
    try {
      const token = await getFirebaseAuth().currentUser?.getIdToken();
      if (!token) throw new Error('Not signed in');
      const res = await fetch('/api/admin/heatzones', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const json = (await res.json()) as HeatzoneResponse;
      if (!res.ok || !json.ok) throw new Error(json.reason || 'Could not load heatzones');
      setHeatData(json);
      setSelectedPage((current) => current ?? json.pageLeaderboard?.[0]?.pageId ?? null);
    } catch (error: any) {
      setHeatData({ ok: false, reason: error?.message ?? 'Could not load heatzones' });
    } finally {
      setHeatBusy(false);
    }
  };

  useEffect(() => {
    if (loading) return;
    if (!user) { window.location.replace('/admin/login'); return; }
    if (user.email?.toLowerCase() !== 'avi2001raj@gmail.com') {
      // Signed in but not as admin — sign out and redirect
      import('firebase/auth').then(({ signOut }) => {
        signOut(getFirebaseAuth()).then(() => window.location.replace('/admin/login'));
      });
      return;
    }
    fetchHeatzones();
  }, [loading, user?.uid, user?.email]);

  // Derive user stats from RTDB snapshot
  const userList = useMemo(() => {
    if (!usersSnapshot) return [];
    return Object.entries(usersSnapshot).map(([uid, val]: [string, any]) => ({
      uid,
      fullName: val?.fullName || 'Unknown',
      email: val?.email || null,
      mobile: val?.mobile || null,
      city: val?.city || null,
      country: val?.country || null,
      photoURL: val?.photoURL || null,
      createdAt: val?.createdAt || null,
      profileVerified: !!val?.profileVerified,
      profileComplete: !!(val?.fullName && val?.dateOfBirth),
      rating: val?.rating ?? null,
      ratingCount: val?.ratingCount ?? null,
      canactScore: val?.canactScore ?? null,
    }));
  }, [usersSnapshot]);

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return userList;
    return userList.filter((row) => {
      const haystack = [row.fullName, row.email, row.mobile, row.uid, row.city, row.country].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [query, userList]);

  const realtimeHeatData = useMemo(() => aggregateRealtimeHeatzones(usersSnapshot), [usersSnapshot]);
  const resolvedHeatData = useMemo(() => mergeHeatzoneResponses(heatData, realtimeHeatData), [heatData, realtimeHeatData]);
  const heatTotals = resolvedHeatData.totals ?? { pageViews: 0, featureClicks: 0, uniquePages: 0 };
  const selectedHeatmap = resolvedHeatData.pageHeatmaps?.find((p) => p.pageId === selectedPage);
  const selectedFeatures = resolvedHeatData.featureLeaderboard?.[selectedPage ?? ''] ?? [];

  useEffect(() => {
    const pages = resolvedHeatData.pageLeaderboard ?? [];
    if (!pages.length) return;
    if (!selectedPage || !pages.some((page) => page.pageId === selectedPage)) setSelectedPage(pages[0].pageId);
  }, [resolvedHeatData, selectedPage]);

  if (loading) return <Splash message="Loading admin..." />;
  if (!user) return <Splash message="Redirecting to admin login…" />;

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
                <Button onClick={fetchHeatzones} loading={heatBusy}>Refresh</Button>
              </div>
            </div>
          </header>

          <div className="space-y-6 px-4 py-5 sm:px-6 lg:px-8">
            {heatData?.ok === false && usersSnapshot === null && activeView === 'heatzones' && (
              <Card className="rounded-lg border-brand-light bg-brand-light/60 text-brand">
                <div className="font-extrabold">Heatzones unavailable</div>
                <p className="mt-1 text-sm">{heatData.reason === 'unauthorized' ? 'Your signed-in account is not configured as an admin.' : heatData.reason}</p>
              </Card>
            )}

            {activeView === 'overview' && (
              <OverviewPage
                userCount={userList.length}
                heatTotals={heatTotals}
                onOpenUsers={() => setActiveView('users')}
                onOpenHeatzones={() => setActiveView('heatzones')}
              />
            )}

            {activeView === 'users' && <UsersPage users={filteredUsers} />}

            {activeView === 'heatzones' && (
              <HeatzonesPage
                data={resolvedHeatData}
                busy={heatBusy}
                selectedPage={selectedPage}
                setSelectedPage={setSelectedPage}
                selectedHeatmap={selectedHeatmap}
                selectedFeatures={selectedFeatures}
              />
            )}

            {activeView === 'navigation' && <NavbarConfigPage />}
          </div>
        </section>
      </div>
    </main>
  );
}

// ── OVERVIEW PAGE ──

function OverviewPage({
  userCount,
  heatTotals,
  onOpenUsers,
  onOpenHeatzones,
}: {
  userCount: number;
  heatTotals: { pageViews: number; featureClicks: number; uniquePages: number };
  onOpenUsers: () => void;
  onOpenHeatzones: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total users" value={userCount} detail="Registered accounts" Icon={Users} />
        <MetricCard label="Page views" value={heatTotals.pageViews} detail="Total tracked visits" Icon={TrendingUp} />
        <MetricCard label="Feature clicks" value={heatTotals.featureClicks} detail="Total interactions" Icon={Zap} />
        <MetricCard label="Active pages" value={heatTotals.uniquePages} detail="Pages with traffic" Icon={Navigation} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="rounded-lg bg-white">
          <SectionHeader title="User directory" eyebrow="Manage" action={<Button variant="outline" size="sm" onClick={onOpenUsers}>View users</Button>} />
          <p className="mt-2 text-sm text-ink/60">Browse, search, and view all registered user profiles and their account status.</p>
          <div className="mt-4 rounded-lg bg-brand-light/50 p-4 text-center">
            <div className="text-4xl font-extrabold text-brand">{userCount}</div>
            <div className="mt-1 text-xs font-bold uppercase tracking-wide text-brand/60">Registered users</div>
          </div>
        </Card>

        <Card className="rounded-lg bg-[#201A17] text-white">
          <SectionHeader title="Heatzones" eyebrow="Analytics" dark action={<Button variant="outline" size="sm" onClick={onOpenHeatzones} className="!border-white/30 !text-white/80 hover:!bg-white/10">Open heatzones</Button>} />
          <p className="mt-2 text-sm text-white/60">Page-level and feature-level heatmaps showing where users go and what they tap.</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-white/10 p-3 text-center">
              <div className="text-2xl font-extrabold">{heatTotals.pageViews}</div>
              <div className="text-[10px] font-bold uppercase text-white/50">Page views</div>
            </div>
            <div className="rounded-lg bg-white/10 p-3 text-center">
              <div className="text-2xl font-extrabold">{heatTotals.featureClicks}</div>
              <div className="text-[10px] font-bold uppercase text-white/50">Feature clicks</div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── USERS PAGE ──

function UsersPage({ users }: { users: Array<{ uid: string; fullName: string; email: string | null; mobile: string | null; city: string | null; country: string | null; photoURL: string | null; createdAt: number | null; profileVerified: boolean; profileComplete: boolean; rating: number | null; ratingCount: number | null }> }) {
  return (
    <Card className="rounded-lg bg-white">
      <SectionHeader title="Users" eyebrow="Directory" />
      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[860px] divide-y divide-line">
          <div className="grid grid-cols-[minmax(240px,1fr)_150px_150px_120px_130px] gap-3 px-3 py-2 text-xs font-extrabold uppercase text-ink/50">
            <span>User</span>
            <span>Phone</span>
            <span>Location</span>
            <span>Status</span>
            <span>Rating</span>
          </div>
          {users.map((row) => (
            <div key={row.uid} className="grid grid-cols-[minmax(240px,1fr)_150px_150px_120px_130px] items-center gap-3 px-3 py-3 text-sm">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar src={row.photoURL} name={row.fullName} size={38} />
                <div className="min-w-0">
                  <div className="truncate font-extrabold text-ink">{row.fullName}</div>
                  <div className="truncate text-xs text-ink/60">{row.email || row.uid}</div>
                </div>
              </div>
              <span className="truncate text-ink/60">{row.mobile || 'Not set'}</span>
              <span className="truncate text-ink/60">{[row.city, row.country].filter(Boolean).join(', ') || 'Not set'}</span>
              <StatusPill tone={row.profileVerified ? 'green' : row.profileComplete ? 'amber' : 'gray'}>
                {row.profileVerified ? 'Verified' : row.profileComplete ? 'Complete' : 'Incomplete'}
              </StatusPill>
              <span className="font-bold text-ink/70">{row.rating !== null ? `${row.rating.toFixed(1)} (${row.ratingCount ?? 0})` : 'Not rated'}</span>
            </div>
          ))}
          {!users.length && <EmptyState title="No users found" detail="Try another search term." />}
        </div>
      </div>
    </Card>
  );
}

// ── HEATZONES PAGE ──

function HeatzonesPage({
  data,
  busy,
  selectedPage,
  setSelectedPage,
  selectedHeatmap,
  selectedFeatures,
}: {
  data: HeatzoneResponse | null;
  busy: boolean;
  selectedPage: string | null;
  setSelectedPage: (page: string) => void;
  selectedHeatmap: HeatzoneResponse['pageHeatmaps'] extends Array<infer T> ? T | undefined : any;
  selectedFeatures: Array<{ featureId: string; clicks: number }>;
}) {
  const leaderboard = data?.pageLeaderboard ?? [];
  const heatmaps = data?.pageHeatmaps ?? [];
  const totalViews = data?.totals?.pageViews ?? 0;

  return (
    <div className="space-y-6">
      {/* Page Leaderboard */}
      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="rounded-lg bg-white">
          <SectionHeader title="Page leaderboard" eyebrow={`${leaderboard.length} pages`} />
          <div className="mt-4 max-h-[calc(var(--canact-viewport-height)-280px)] space-y-1 overflow-auto pr-1">
            {leaderboard.map((page, i) => {
              const active = selectedPage === page.pageId;
              const pct = totalViews ? Math.round((page.views / totalViews) * 100) : 0;
              return (
                <button
                  key={page.pageId}
                  type="button"
                  onClick={() => setSelectedPage(page.pageId)}
                  className={`w-full rounded-lg border p-3 text-left transition ${active ? 'border-brand bg-brand-light' : 'border-line bg-white hover:border-brand/40'}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-extrabold text-ink">{page.pageId}</div>
                      <div className="text-xs text-ink/60">{page.views} views · {pct}%</div>
                    </div>
                    <span className="shrink-0 text-lg font-extrabold text-brand">#{i + 1}</span>
                  </div>
                  {/* Progress bar */}
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#EFE5DE]">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                  </div>
                </button>
              );
            })}
            {!leaderboard.length && <EmptyState title={busy ? 'Loading...' : 'No page view data yet'} detail="Page visits will appear here as users navigate the app." />}
          </div>
        </Card>

        {/* Per-page heatmap */}
        <div className="space-y-6">
          {selectedHeatmap ? (
            <>
              {/* Jumps heatmap */}
              <Card className="rounded-lg bg-white">
                <SectionHeader title={`${selectedHeatmap.pageId} · User jumps`} eyebrow={`${selectedHeatmap.views} total views`} />
                <div className="mt-4 space-y-3">
                  {selectedHeatmap.jumps.map((jump: { from: string; count: number; pct: number }) => (
                    <div key={jump.from}>
                      <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                        <span className="truncate font-bold text-ink/70">← {jump.from}</span>
                        <span className="shrink-0 text-xs font-extrabold text-ink/50">{jump.count} · {jump.pct}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-[#EFE5DE]">
                        <div className="h-full rounded-full bg-amber-400/70" style={{ width: `${Math.max(jump.pct, 2)}%` }} />
                      </div>
                    </div>
                  ))}
                  {!selectedHeatmap.jumps.length && <p className="text-sm text-ink/50">No jump data for this page yet.</p>}
                </div>
              </Card>

              {/* Feature leaderboard */}
              <Card className="rounded-lg bg-[#201A17] text-white">
                <SectionHeader title={`${selectedHeatmap.pageId} · Features`} eyebrow={`${selectedFeatures.length} features`} dark />
                <div className="mt-4 space-y-3">
                  {selectedFeatures.map((feat: { featureId: string; clicks: number }, i: number) => {
                    const maxClicks = selectedFeatures[0]?.clicks ?? 1;
                    const pct = Math.round((feat.clicks / maxClicks) * 100);
                    return (
                      <div key={feat.featureId}>
                        <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                          <span className="truncate font-bold text-white/75">{feat.featureId}</span>
                          <span className="shrink-0 text-xs font-extrabold text-white/50">{feat.clicks} clicks</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-white/10">
                          <div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.max(pct, 3)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  {!selectedFeatures.length && <p className="text-sm text-white/50">No feature interactions recorded for this page yet.</p>}
                </div>
              </Card>
            </>
          ) : (
            <Card className="rounded-lg bg-white">
              <EmptyState title="Select a page" detail="Choose a page from the leaderboard to view its heatmap and feature breakdown." />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ── SHARED COMPONENTS ──

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

/* ================================================================
   NAVIGATION CONFIG
   ================================================================ */

type NavbarConfig = { tabs: string[]; plusIcon: string; plusItems: string[] };

const PLUS_ICON_OPTIONS: Array<{ id: string; label: string; Icon: LucideIcon }> = [
  { id: 'Plus', label: 'Plus', Icon: Plus },
  { id: 'Menu', label: 'Menu', Icon: AlignLeft },
  { id: 'Sparkles', label: 'Sparkles', Icon: Sparkles },
  { id: 'Camera', label: 'Camera', Icon: Camera },
  { id: 'Pencil', label: 'Edit', Icon: Pencil },
];

const ALL_PLUS_PAGES = [
  { href: '/help',          label: 'Help',     Icon: HandHeart },
  { href: '/story/create',  label: 'Story',    Icon: Sparkles },
  { href: '/post/create',   label: 'Post',     Icon: Camera },
  { href: '/reel/create',   label: 'Reel',     Icon: Film },
  { href: '/poll/create',   label: 'Poll',     Icon: BarChart3 },
  { href: '/rateme/start',  label: 'Rate me',  Icon: Eye },
  { href: '/feed',          label: 'Feed',     Icon: Grid3X3 },
  { href: '/leaderboard',   label: 'Leaderboard', Icon: Activity },
  { href: '/search',        label: 'Search',   Icon: Search },
  { href: '/inbox',         label: 'Inbox',    Icon: MessageSquare },
  { href: '/notifications', label: 'Notifications', Icon: Bell },
  { href: '/profile',       label: 'Profile',  Icon: Users },
  { href: '/settings',      label: 'Settings', Icon: ShieldAlert },
  { href: '/underground',   label: 'Underground', Icon: Globe2 },
];

const DEFAULT_NAVBAR: NavbarConfig = {
  tabs: ['/', '/favourites', '/feed', '/leaderboard'],
  plusIcon: 'Plus',
  plusItems: ['/help', '/story/create', '/post/create', '/reel/create', '/poll/create', '/rateme/start'],
};

const ALL_TABS = [
  { href: '/',             label: 'Home',          Icon: Home },
  { href: '/favourites',  label: 'Nearby',        Icon: MapPinIcon },
  { href: '/feed',        label: 'Community',     Icon: Grid3X3 },
  { href: '/leaderboard', label: 'Leaderboard',   Icon: Activity },
];


function NavbarConfigPage() {
  const [config, setConfig] = useState<NavbarConfig>(DEFAULT_NAVBAR);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    return onValue(dbRef(db, 'config/navbar'), (snap) => {
      const val = snap.val() as NavbarConfig | null;
      if (val) setConfig((prev) => ({ ...prev, ...val }));
    });
  }, []);

  const toggleTab = (href: string) => {
    setConfig((prev) => ({ ...prev, tabs: prev.tabs.includes(href) ? prev.tabs.filter((t) => t !== href) : [...prev.tabs, href] }));
  };
  const togglePlusItem = (href: string) => {
    setConfig((prev) => ({ ...prev, plusItems: prev.plusItems.includes(href) ? prev.plusItems.filter((i) => i !== href) : [...prev.plusItems, href] }));
  };
  const setPlusIcon = (id: string) => setConfig((prev) => ({ ...prev, plusIcon: id }));

  const save = async () => {
    setSaving(true);
    try { await dbSet(dbRef(db, 'config/navbar'), config); toast('Navigation config saved', 'success'); }
    catch (error: any) { toast(error?.message ?? 'Could not save config', 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-lg bg-white">
        <SectionHeader title="Bottom navigation tabs" eyebrow="Mobile app" action={<Button onClick={save} loading={saving} size="sm">Save config</Button>} />
        <p className="mb-4 text-sm text-ink/60">Toggle tabs in the bottom nav. Bar width adjusts automatically based on count.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {ALL_TABS.map(({ href, label, Icon }) => {
            const enabled = config.tabs.includes(href);
            return (
              <button key={href} type="button" onClick={() => toggleTab(href)}
                className={`flex items-center gap-3 rounded-lg border p-4 text-left transition ${enabled ? 'border-brand bg-brand/8 text-brand' : 'border-[#E0D4CA] bg-white text-ink/60 hover:border-brand/40'}`}>
                <Icon className="h-5 w-5 shrink-0" /><span><span className="block text-sm font-extrabold">{label}</span><span className="block text-xs text-ink/50">{href}</span></span>
                {enabled && <Check className="ml-auto h-5 w-5 shrink-0 text-brand" />}
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="rounded-lg bg-white">
        <SectionHeader title="Plus button icon" eyebrow="Customize" />
        <p className="mb-4 text-sm text-ink/60">Choose the icon for the floating create button.</p>
        <div className="grid gap-3 grid-cols-4">
          {PLUS_ICON_OPTIONS.map(({ id, label, Icon }) => {
            const active = config.plusIcon === id;
            return (
              <button key={id} type="button" onClick={() => setPlusIcon(id)}
                className={`flex flex-col items-center gap-2 rounded-lg border p-4 transition ${active ? 'border-brand bg-brand/8 text-brand' : 'border-[#E0D4CA] bg-white text-ink/60 hover:border-brand/40'}`}>
                <Icon className="h-7 w-7" /><span className="text-xs font-extrabold">{label}</span>
                {active && <Check className="h-4 w-4 text-brand" />}
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="rounded-lg bg-white">
        <SectionHeader title="Plus menu items" eyebrow="Create menu" />
        <p className="mb-4 text-sm text-ink/60">Toggle pages that appear when tapping the plus button.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ALL_PLUS_PAGES.map(({ href, label, Icon }) => {
            const enabled = config.plusItems.includes(href);
            return (
              <button key={href} type="button" onClick={() => togglePlusItem(href)}
                className={`flex items-center gap-3 rounded-lg border p-3 text-left transition ${enabled ? 'border-brand bg-brand/8 text-brand' : 'border-[#E0D4CA] bg-white text-ink/60 hover:border-brand/40'}`}>
                <Icon className="h-4 w-4 shrink-0" /><span className="text-sm font-extrabold">{label}</span>
                {enabled && <Check className="ml-auto h-4 w-4 shrink-0 text-brand" />}
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

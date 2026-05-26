import { NextResponse } from 'next/server';
import { getFirebaseAdminApp, readAdminRtdb, verifyAdminRequest } from '@/lib/server/firebaseAdmin';

export const runtime = 'nodejs';

type BackupRecord = {
  name?: string;
  size?: number;
  contentType?: string;
  pathname?: string;
  access?: string;
  createdAt?: number;
};

type UserRecord = {
  fullName?: string;
  email?: string;
  mobile?: string;
  city?: string;
  country?: string;
  photoURL?: string;
  createdAt?: number;
  profileComplete?: boolean;
  profileVerified?: boolean;
  rating?: number;
  ratingCount?: number;
};

export async function GET(request: Request) {
  const app = getFirebaseAdminApp();
  const admin = await verifyAdminRequest(request, app);
  if (!admin) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const [usersSnap, backupsSnap] = await Promise.all([
    readAdminRtdb<Record<string, UserRecord>>('users', app, admin.idToken),
    readAdminRtdb<Record<string, { items?: Record<string, BackupRecord> }>>('userBackups', app, admin.idToken),
  ]);
  const users = usersSnap ?? {};
  const backups = backupsSnap ?? {};

  const allUids = new Set([...Object.keys(users), ...Object.keys(backups)]);
  const rows = Array.from(allUids).map((uid) => {
    const backupNode = backups[uid];
    const profile = users[uid] ?? {};
    const items = Object.entries(backupNode?.items ?? {})
      .filter(([, item]) => typeof item?.pathname === 'string' && item.pathname.startsWith('backup/'))
      .map(([id, item]) => ({
        id,
        name: String(item.name || 'file'),
        size: typeof item.size === 'number' ? item.size : 0,
        contentType: String(item.contentType || 'application/octet-stream'),
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : 0,
        access: item.access === 'public' ? 'public' : 'private',
        downloadPath: `/api/admin/backups/${encodeURIComponent(uid)}/${encodeURIComponent(id)}/download`,
      }))
      .sort((left, right) => right.createdAt - left.createdAt);
    const totalBytes = items.reduce((sum, item) => sum + item.size, 0);
    const latestBackupAt = items[0]?.createdAt ?? 0;
    return {
      uid,
      user: {
        uid,
        fullName: profile.fullName ?? 'Canact user',
        email: profile.email ?? null,
        mobile: profile.mobile ?? null,
        city: profile.city ?? null,
        country: profile.country ?? null,
        photoURL: profile.photoURL ?? null,
        createdAt: profile.createdAt ?? null,
        profileComplete: profile.profileComplete ?? null,
        profileVerified: profile.profileVerified ?? null,
        rating: typeof profile.rating === 'number' ? profile.rating : null,
        ratingCount: typeof profile.ratingCount === 'number' ? profile.ratingCount : null,
      },
      itemCount: items.length,
      totalBytes,
      latestBackupAt,
      items,
    };
  }).sort((left, right) => {
    if (right.latestBackupAt !== left.latestBackupAt) return right.latestBackupAt - left.latestBackupAt;
    return left.user.fullName.localeCompare(right.user.fullName);
  });

  return NextResponse.json({
    ok: true,
    fetchedAt: Date.now(),
    admin,
    totals: {
      users: rows.length,
      usersWithBackups: rows.filter((row) => row.itemCount > 0).length,
      files: rows.reduce((sum, row) => sum + row.itemCount, 0),
      bytes: rows.reduce((sum, row) => sum + row.totalBytes, 0),
    },
    users: rows,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
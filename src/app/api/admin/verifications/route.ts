import { NextResponse } from 'next/server';
import {
  getFirebaseAdminApp,
  patchUserRtdb,
  readAdminRtdb,
  verifyAdminRequest,
} from '@/lib/server/firebaseAdmin';

export const runtime = 'nodejs';

const COOLDOWN_MS = 15 * 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  const app = getFirebaseAdminApp();
  const admin = await verifyAdminRequest(req, app);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const [requests, users] = await Promise.all([
      readAdminRtdb<Record<string, any>>('verificationRequests', app, admin.idToken),
      readAdminRtdb<Record<string, any>>('users', app, admin.idToken),
    ]);
    const items = Object.entries(requests ?? {}).map(([uid, request]) => ({
      ...request,
      uid,
      fullName: users?.[uid]?.fullName || 'Unknown user',
      email: users?.[uid]?.email || null,
      mobile: users?.[uid]?.mobile || null,
      photoURL: users?.[uid]?.photoURL || null,
    })).sort((left, right) => Number(right.submittedAt || 0) - Number(left.submittedAt || 0));
    return NextResponse.json({ ok: true, requests: items });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? 'Could not load verification requests.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const app = getFirebaseAdminApp();
  const admin = await verifyAdminRequest(req, app);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const uid = String(body?.uid || '').trim();
    const decision = body?.decision === 'approve' ? 'approve' : body?.decision === 'reject' ? 'reject' : '';
    const reason = String(body?.reason || '').trim().slice(0, 500);
    if (!uid || !decision) return NextResponse.json({ ok: false, error: 'Invalid review decision.' }, { status: 400 });
    if (decision === 'reject' && reason.length < 3) {
      return NextResponse.json({ ok: false, error: 'Add a rejection reason for the applicant.' }, { status: 400 });
    }

    const [request, user] = await Promise.all([
      readAdminRtdb<any>(`verificationRequests/${uid}`, app, admin.idToken),
      readAdminRtdb<any>(`users/${uid}`, app, admin.idToken),
    ]);
    if (!request || !user) return NextResponse.json({ ok: false, error: 'Verification request not found.' }, { status: 404 });
    if (request.status !== 'pending') return NextResponse.json({ ok: false, error: 'This request has already been reviewed.' }, { status: 409 });

    const now = Date.now();
    const notificationId = `verification_${now}`;
    const reviewedBy = { uid: admin.uid, email: admin.email };
    const updates: Record<string, unknown> = {
      [`verificationRequests/${uid}/reviewedAt`]: now,
      [`verificationRequests/${uid}/reviewedBy`]: reviewedBy,
      [`verificationRequests/${uid}/updatedAt`]: now,
    };

    if (decision === 'approve') {
      const tags = Array.from(new Set([...(user.tags ?? []).filter((tag: string) => tag !== 'Unverified Profile'), 'Verified Profile']));
      const badges = Array.from(new Set([...(user.badges ?? []), 'Verified']));
      Object.assign(updates, {
        [`verificationRequests/${uid}/status`]: 'approved',
        [`users/${uid}/profileVerified`]: true,
        [`users/${uid}/verificationProvider`]: 'manual',
        [`users/${uid}/verificationStatus`]: 'approved',
        [`users/${uid}/verifiedAt`]: now,
        [`users/${uid}/verificationLockedAt`]: now,
        [`users/${uid}/verificationRejectedAt`]: null,
        [`users/${uid}/verificationCooldownUntil`]: null,
        [`users/${uid}/verificationRejectionReason`]: null,
        [`users/${uid}/tags`]: tags,
        [`users/${uid}/badges`]: badges,
        [`notifications/${uid}/${notificationId}`]: {
          type: 'verification-approved',
          title: 'Identity verified',
          message: 'Your manual verification was approved.',
          createdAt: now,
          read: false,
        },
      });
    } else {
      const cooldownUntil = now + COOLDOWN_MS;
      Object.assign(updates, {
        [`verificationRequests/${uid}/status`]: 'rejected',
        [`verificationRequests/${uid}/rejectionReason`]: reason,
        [`verificationRequests/${uid}/rejectedAt`]: now,
        [`verificationRequests/${uid}/cooldownUntil`]: cooldownUntil,
        [`users/${uid}/profileVerified`]: false,
        [`users/${uid}/verificationStatus`]: 'rejected',
        [`users/${uid}/verificationRejectedAt`]: now,
        [`users/${uid}/verificationCooldownUntil`]: cooldownUntil,
        [`users/${uid}/verificationRejectionReason`]: reason,
        [`notifications/${uid}/${notificationId}`]: {
          type: 'verification-rejected',
          title: 'Verification needs attention',
          message: `Your request was not approved. You can reapply after ${new Date(cooldownUntil).toLocaleDateString('en-IN')}.`,
          createdAt: now,
          read: false,
        },
      });
    }

    await patchUserRtdb('', updates, app, admin.idToken);
    return NextResponse.json({ ok: true, status: decision === 'approve' ? 'approved' : 'rejected' });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? 'Could not review verification request.' }, { status: 500 });
  }
}

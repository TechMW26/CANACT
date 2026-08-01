import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  deleteUserRtdb,
  getFirebaseAdminApp,
  patchUserRtdb,
  readAdminRtdb,
  verifyUserRequest,
} from '@/lib/server/firebaseAdmin';

export const runtime = 'nodejs';

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? '',
    middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
    lastName: parts.length > 1 ? parts[parts.length - 1] : '',
  };
}

function otpHash(requestId: string, otp: string) {
  const secret = process.env.KYC_OTP_HASH_SECRET
    ?? (process.env.NODE_ENV !== 'production' ? 'canact-local-kyc' : '');
  if (!secret) throw new Error('KYC verification is not configured.');
  return createHmac('sha256', secret).update(`${requestId}:${otp}`).digest('hex');
}

function hashesMatch(left: string, right: string) {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  try {
    const app = getFirebaseAdminApp();
    const verified = await verifyUserRequest(req, app);
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const otp = String(body?.otp ?? '').trim();
    const requestId = String(body?.requestId ?? '').trim();
    if (!/^\d{6}$/.test(otp) || !requestId) {
      return NextResponse.json({ error: 'Missing verification details.' }, { status: 400 });
    }

    const request = await readAdminRtdb<any>(`verificationRequests/${verified.uid}`, app, verified.idToken);
    if (!request || request.requestId !== requestId) {
      return NextResponse.json({ error: 'Verification request expired. Please request a new OTP.' }, { status: 410 });
    }
    if ((request.expiresAt ?? 0) < Date.now() || (request.attempts ?? 0) >= 5) {
      await deleteUserRtdb(`verificationRequests/${verified.uid}`, app, verified.idToken);
      return NextResponse.json({ error: 'Verification request expired. Please request a new OTP.' }, { status: 410 });
    }
    if (!hashesMatch(otpHash(requestId, otp), String(request.otpHash ?? ''))) {
      await patchUserRtdb(
        `verificationRequests/${verified.uid}`,
        { attempts: (request.attempts ?? 0) + 1 },
        app,
        verified.idToken,
      );
      return NextResponse.json({ error: 'Incorrect OTP. Please try again.' }, { status: 400 });
    }

    const user = await readAdminRtdb<any>(`users/${verified.uid}`, app, verified.idToken);
    if (!user) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });

    const fullName = user.fullName || [user.firstName, user.middleName, user.lastName].filter(Boolean).join(' ');
    const address = user.address || [user.city, user.country].filter(Boolean).join(', ') || 'Verified address on file';
    const dateOfBirth = user.dateOfBirth || '2001-01-01';
    const parts = splitName(fullName);
    const tags = Array.from(new Set([...(user.tags ?? []).filter((tag: string) => tag !== 'Unverified Profile'), 'Verified Profile']));
    const badges = Array.from(new Set([...(user.badges ?? []), 'Verified']));
    const now = Date.now();

    await patchUserRtdb(`users/${verified.uid}`, {
      fullName,
      firstName: parts.firstName,
      middleName: parts.middleName || null,
      lastName: parts.lastName || null,
      address,
      dateOfBirth,
      profileVerified: true,
      verificationProvider: 'digilocker',
      verificationIdLast4: request.aadhaarLast4,
      verifiedAt: now,
      verificationLockedAt: now,
      tags,
      badges,
    }, app, verified.idToken);
    await deleteUserRtdb(`verificationRequests/${verified.uid}`, app, verified.idToken);

    return NextResponse.json({
      ok: true,
      profile: {
        fullName,
        address,
        dateOfBirth,
        provider: 'digilocker',
        verifiedAt: now,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to complete verification' }, { status: 500 });
  }
}

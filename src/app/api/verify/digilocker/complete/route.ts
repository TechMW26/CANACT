import { NextResponse } from 'next/server';
import { rtdbDelete, rtdbGet, rtdbPatch } from '@/lib/server/rtdb';

export const runtime = 'nodejs';

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? '',
    middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
    lastName: parts.length > 1 ? parts[parts.length - 1] : '',
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const uid = String(body?.uid ?? '').trim();
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const otp = String(body?.otp ?? '').trim();
    const requestId = String(body?.requestId ?? '').trim();
    if (!otp || !requestId) {
      return NextResponse.json({ error: 'Missing verification details.' }, { status: 400 });
    }

    const request = await rtdbGet<any>(`verificationRequests/${uid}`);
    if (!request || request.requestId !== requestId) {
      return NextResponse.json({ error: 'Verification request expired. Please request a new OTP.' }, { status: 410 });
    }
    if (otp !== String(request.otp)) {
      await rtdbPatch(`verificationRequests/${uid}`, { attempts: (request.attempts ?? 0) + 1 });
      return NextResponse.json({ error: 'Incorrect OTP. Please try again.' }, { status: 400 });
    }

    const user = await rtdbGet<any>(`users/${uid}`);
    if (!user) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });

    const fullName = user.fullName || [user.firstName, user.middleName, user.lastName].filter(Boolean).join(' ');
    const address = user.address || [user.city, user.country].filter(Boolean).join(', ') || 'Verified address on file';
    const dateOfBirth = user.dateOfBirth || '2001-01-01';
    const parts = splitName(fullName);
    const tags = Array.from(new Set([...(user.tags ?? []).filter((tag: string) => tag !== 'Unverified Profile'), 'Verified Profile']));
    const badges = Array.from(new Set([...(user.badges ?? []), 'Verified']));
    const now = Date.now();

    await rtdbPatch(`users/${uid}`, {
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
    });
    await rtdbDelete(`verificationRequests/${uid}`);

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
import { NextResponse } from 'next/server';
import { createHmac, randomBytes } from 'node:crypto';
import {
  getFirebaseAdminApp,
  readAdminRtdb,
  verifyUserRequest,
  writeUserRtdb,
} from '@/lib/server/firebaseAdmin';

export const runtime = 'nodejs';

function otpHash(requestId: string, otp: string) {
  const secret = process.env.KYC_OTP_HASH_SECRET
    ?? (process.env.NODE_ENV !== 'production' ? 'canact-local-kyc' : '');
  if (!secret) throw new Error('KYC verification is not configured.');
  return createHmac('sha256', secret).update(`${requestId}:${otp}`).digest('hex');
}

export async function POST(req: Request) {
  try {
    const app = getFirebaseAdminApp();
    const verified = await verifyUserRequest(req, app);
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const aadhaarNumber = String(body?.aadhaarNumber ?? '').replace(/\D/g, '');
    if (aadhaarNumber.length !== 12) {
      return NextResponse.json({ error: 'Enter a valid 12-digit Aadhaar number.' }, { status: 400 });
    }

    const previous = await readAdminRtdb<{ createdAt?: number }>(
      `verificationRequests/${verified.uid}`,
      app,
      verified.idToken,
    );
    if (previous?.createdAt && Date.now() - previous.createdAt < 60_000) {
      return NextResponse.json({ error: 'Please wait one minute before requesting another OTP.' }, { status: 429 });
    }

    // The real DigiLocker provider must replace this adapter before production.
    // A configured mock OTP keeps local/staging verification deterministic without
    // ever persisting an Aadhaar number or a plaintext OTP.
    const otp = process.env.DIGILOCKER_MOCK_OTP;
    if (!otp || !/^\d{6}$/.test(otp)) {
      return NextResponse.json({ error: 'DigiLocker verification is temporarily unavailable.' }, { status: 503 });
    }
    const requestId = `dg_${Date.now()}_${randomBytes(12).toString('hex')}`;
    await writeUserRtdb(`verificationRequests/${verified.uid}`, {
      requestId,
      aadhaarLast4: aadhaarNumber.slice(-4),
      otpHash: otpHash(requestId, otp),
      createdAt: Date.now(),
      expiresAt: Date.now() + 5 * 60_000,
      attempts: 0,
      mode: 'mock',
    }, app, verified.idToken);

    return NextResponse.json({
      requestId,
      message: 'OTP sent for DigiLocker verification.',
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to send OTP' }, { status: 500 });
  }
}

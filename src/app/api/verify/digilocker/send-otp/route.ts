import { NextResponse } from 'next/server';
import { rtdbPut } from '@/lib/server/rtdb';

export const runtime = 'nodejs';

function randomOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const uid = String(body?.uid ?? '').trim();
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const aadhaarNumber = String(body?.aadhaarNumber ?? '').replace(/\D/g, '');
    if (aadhaarNumber.length !== 12) {
      return NextResponse.json({ error: 'Enter a valid 12-digit Aadhaar number.' }, { status: 400 });
    }

    const requestId = `dg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const otp = process.env.DIGILOCKER_MOCK_OTP || randomOtp();
    await rtdbPut(`verificationRequests/${uid}`, {
      requestId,
      aadhaarLast4: aadhaarNumber.slice(-4),
      otp,
      createdAt: Date.now(),
      attempts: 0,
      mode: 'mock',
    });

    return NextResponse.json({
      requestId,
      message: process.env.DIGILOCKER_MOCK_OTP
        ? 'OTP sent for DigiLocker verification.'
        : 'OTP sent for DigiLocker verification. Demo mode OTP is 123456 only if you set DIGILOCKER_MOCK_OTP=123456.',
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to send OTP' }, { status: 500 });
  }
}
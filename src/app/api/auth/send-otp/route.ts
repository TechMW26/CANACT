import { NextResponse } from 'next/server';
import { randomInt } from 'node:crypto';
import { createOtpChallenge } from '@/lib/server/otpChallenge';

export const runtime = 'nodejs';

function messagingUrl() {
  const base = (process.env.VOBZ_API_URL || 'https://api.vobiz.ai').replace(/\/$/, '');
  if (base.endsWith('/messages')) return base;
  if (base.includes('/v1/messaging')) return `${base}/messages`;
  if (base.endsWith('/v1')) return `${base}/messaging/messages`;
  return `${base}/v1/messaging/messages`;
}

export async function POST(request: Request) {
  try {
    const { phone } = (await request.json()) as { phone?: string };
    if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone)) {
      return NextResponse.json({ ok: false, error: 'Enter a valid phone number.' }, { status: 400 });
    }

    const authId = process.env.VOBZ_AUTH_ID;
    const authToken = process.env.VOBZ_AUTH_TOKEN;
    const channelId = process.env.VOBZ_CHANNEL_ID;
    const templateName = process.env.VOBZ_OTP_TEMPLATE;
    if (!authId || !authToken || !channelId || !templateName) {
      console.error('[OTP] Fallback delivery is not configured');
      return NextResponse.json({ ok: false, error: 'Verification is temporarily unavailable.' }, { status: 503 });
    }

    const otp = String(randomInt(100000, 1000000));
    const response = await fetch(messagingUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-ID': authId,
        'X-Auth-Token': authToken,
      },
      body: JSON.stringify({
        channel_id: channelId,
        to: phone,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: otp }] }],
        },
      }),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({})) as { ok?: boolean; success?: boolean; error?: string; message?: string };
    if (!response.ok || data.ok === false || data.success === false) {
      console.warn('[OTP] Vobiz send failed', response.status, data.error || data.message || 'unknown');
      return NextResponse.json({ ok: false, error: 'Verification is temporarily unavailable.' }, { status: 502 });
    }

    return NextResponse.json({ ok: true, challenge: createOtpChallenge(phone, otp) });
  } catch (error) {
    console.error('[OTP] send route failed', error);
    return NextResponse.json({ ok: false, error: 'Verification is temporarily unavailable.' }, { status: 500 });
  }
}

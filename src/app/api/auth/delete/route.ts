import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession } from '@/lib/server/jwt';
import { rtdbGet, rtdbDelete, encodeKey } from '@/lib/server/rtdb';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const tok = cookies().get(SESSION_COOKIE)?.value;
    const session = tok ? await verifySession(tok) : null;
    if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    const profile = await rtdbGet<any>(`users/${session.uid}`);
    if (profile?.mobile) await rtdbDelete(`lookups/byMobile/${String(profile.mobile).replace(/[^0-9]/g, '')}`).catch(() => {});
    if (profile?.email) await rtdbDelete(`lookups/byEmail/${encodeKey(profile.email)}`).catch(() => {});
    await rtdbDelete(`users/${session.uid}`);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession } from '@/lib/server/jwt';

export const runtime = 'nodejs';

export async function GET() {
  const tok = cookies().get(SESSION_COOKIE)?.value;
  if (!tok) return NextResponse.json({ uid: null });
  const session = await verifySession(tok);
  return NextResponse.json({ uid: session?.uid ?? null });
}

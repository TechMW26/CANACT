// Minimal server-side RTDB REST client. No service-account auth (rules are open in test mode).
const BASE =
  process.env.NEXT_PUBLIC_FIREBASE_DB_URL ??
  'https://canact-94ad6-default-rtdb.asia-southeast1.firebasedatabase.app';

export async function rtdbGet<T = any>(path: string): Promise<T | null> {
  const r = await fetch(`${BASE}/${path}.json`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`RTDB GET ${path} failed: ${r.status}`);
  return (await r.json()) as T | null;
}

export async function rtdbPut(path: string, value: any): Promise<void> {
  const r = await fetch(`${BASE}/${path}.json`, {
    method: 'PUT', body: JSON.stringify(value), headers: { 'content-type': 'application/json' },
  });
  if (!r.ok) throw new Error(`RTDB PUT ${path} failed: ${r.status}`);
}

export async function rtdbPatch(path: string, value: any): Promise<void> {
  const r = await fetch(`${BASE}/${path}.json`, {
    method: 'PATCH', body: JSON.stringify(value), headers: { 'content-type': 'application/json' },
  });
  if (!r.ok) throw new Error(`RTDB PATCH ${path} failed: ${r.status}`);
}

export async function rtdbDelete(path: string): Promise<void> {
  const r = await fetch(`${BASE}/${path}.json`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`RTDB DELETE ${path} failed: ${r.status}`);
}

export function encodeKey(s: string): string {
  return s.toLowerCase().replace(/[.#$/[\]]/g, '_');
}

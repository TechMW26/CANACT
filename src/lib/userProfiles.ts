export function withProfileUid<T extends { uid?: string }>(
  uid: string,
  value: T | null | undefined,
): (T & { uid: string }) | null {
  return value ? { ...value, uid } : null;
}

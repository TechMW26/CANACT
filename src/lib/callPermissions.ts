// Bridge to the native CallPermissions plugin (Android-only). Web/iOS get
// safe defaults so callers don't have to branch.
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface CallPermissionsPlugin {
  canUseFullScreenIntent(): Promise<{ granted: boolean }>;
  openFullScreenIntentSettings(): Promise<void>;
}

const native = registerPlugin<CallPermissionsPlugin>('CallPermissions');

const isAndroidNative = (): boolean => {
  try { return Capacitor.getPlatform() === 'android'; } catch { return false; }
};

export async function canUseFullScreenIntent(): Promise<boolean> {
  if (!isAndroidNative()) return true;
  try {
    const r = await native.canUseFullScreenIntent();
    return !!r?.granted;
  } catch {
    return false;
  }
}

export async function openFullScreenIntentSettings(): Promise<void> {
  if (!isAndroidNative()) return;
  try { await native.openFullScreenIntentSettings(); } catch { /* no-op */ }
}

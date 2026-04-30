// Bridge to the native CallPermissions plugin (Android-only). Web/iOS get
// safe defaults so callers don't have to branch.
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface CallPermissionsPlugin {
  canUseFullScreenIntent(): Promise<{ granted: boolean }>;
  openFullScreenIntentSettings(): Promise<void>;
  isIgnoringBatteryOptimizations(): Promise<{ granted: boolean }>;
  requestIgnoreBatteryOptimizations(): Promise<void>;
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

/**
 * Whether Android Doze / App Standby is currently exempted for our package.
 * If false, the FCM socket can be reaped while the screen is off and
 * incoming-call pushes will arrive late or not at all.
 */
export async function isIgnoringBatteryOptimizations(): Promise<boolean> {
  if (!isAndroidNative()) return true;
  try {
    const r = await native.isIgnoringBatteryOptimizations();
    return !!r?.granted;
  } catch {
    return false;
  }
}

export async function requestIgnoreBatteryOptimizations(): Promise<void> {
  if (!isAndroidNative()) return;
  try { await native.requestIgnoreBatteryOptimizations(); } catch { /* no-op */ }
}

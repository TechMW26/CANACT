// Thin wrapper around the native AudioRouter Capacitor plugin (Android-only).
// Web/iOS get a no-op so callers don't have to branch \u2014 they just call
// startCall/setSpeaker/endCall and we'll route through the device earpiece on
// real Android hardware (matching WhatsApp/Signal voice-call behaviour) and
// silently fall through everywhere else.
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface AudioRouterPlugin {
  startCall(opts: { speaker: boolean }): Promise<{ speaker: boolean }>;
  setSpeaker(opts: { on: boolean }): Promise<{ speaker: boolean }>;
  endCall(): Promise<void>;
}

const native = registerPlugin<AudioRouterPlugin>('AudioRouter');

const isAndroidNative = (): boolean => {
  try { return Capacitor.getPlatform() === 'android'; } catch { return false; }
};

export async function startCallAudio(speaker = false): Promise<void> {
  if (!isAndroidNative()) return;
  try { await native.startCall({ speaker }); } catch { /* no-op */ }
}

export async function setCallSpeaker(on: boolean): Promise<void> {
  if (!isAndroidNative()) return;
  try { await native.setSpeaker({ on }); } catch { /* no-op */ }
}

export async function endCallAudio(): Promise<void> {
  if (!isAndroidNative()) return;
  try { await native.endCall(); } catch { /* no-op */ }
}

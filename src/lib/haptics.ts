// Lightweight haptics helper. Uses the Web Vibration API where available
// (Android Chrome). iOS Safari currently ignores navigator.vibrate, so we
// silently no-op there — the calls are still safe to make everywhere.

type HapticKind = 'subtle' | 'strong' | 'success' | 'selection';

function vibrate(pattern: number | number[]) {
  if (typeof window === 'undefined') return;
  const nav = window.navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
  if (nav.userActivation && !nav.userActivation.hasBeenActive) return;
  try { nav.vibrate?.(pattern); } catch { /* ignore */ }
}

export function haptic(kind: HapticKind = 'subtle') {
  switch (kind) {
    case 'strong':    return vibrate(28);
    case 'success':   return vibrate([12, 30, 18]);
    case 'selection': return vibrate(6);
    case 'subtle':
    default:          return vibrate(10);
  }
}

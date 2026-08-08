// Lightweight cross-platform haptics helper. Standards-based browsers use
// the Vibration API. iOS WebKit has no general vibration API, but iOS 18+
// gives switch controls a native tactile tick, which provides a best-effort
// fallback when this function is called synchronously from a user gesture.

type HapticKind = 'subtle' | 'strong' | 'success' | 'selection';

let iosSwitch: HTMLInputElement | null = null;
let iosSwitchLabel: HTMLLabelElement | null = null;

function isIOSWebKit() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function ensureIOSSwitch() {
  if (iosSwitch && iosSwitchLabel && document.body.contains(iosSwitchLabel)) return iosSwitchLabel;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.setAttribute('aria-hidden', 'true');
  input.tabIndex = -1;
  input.id = `canact-haptic-${Math.random().toString(36).slice(2)}`;
  input.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;clip-path:inset(50%);pointer-events:none;';

  const label = document.createElement('label');
  label.htmlFor = input.id;
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;';
  document.body.append(input, label);
  iosSwitch = input;
  iosSwitchLabel = label;
  return label;
}

function vibrate(pattern: number | number[]) {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
  try {
    if (typeof nav.vibrate === 'function') {
      if (nav.userActivation && !nav.userActivation.hasBeenActive) return false;
      return nav.vibrate(pattern);
    }
    if (isIOSWebKit()) {
      if (nav.userActivation && !nav.userActivation.isActive) return false;
      ensureIOSSwitch().click();
      return true;
    }
  } catch { /* unsupported platforms intentionally no-op */ }
  return false;
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

import type { MoodKind } from '@/lib/types';
import {
  Activity,
  AlertTriangle,
  BatteryLow,
  Clock,
  Frown,
  Heart,
  Laugh,
  Minus,
  Smile,
  UserMinus,
} from '@/components/icons';

const MOOD_ICONS = {
  joyful: Laugh,
  calm: Smile,
  grateful: Heart,
  tired: Clock,
  drained: BatteryLow,
  numb: Minus,
  sad: Frown,
  anxious: AlertTriangle,
  lonely: UserMinus,
} satisfies Record<MoodKind, typeof Activity>;

export function MoodIcon({ kind, size = 20, strokeWidth = 2 }: { kind: MoodKind; size?: number; strokeWidth?: number }) {
  const Icon = MOOD_ICONS[kind];
  return <Icon size={size} strokeWidth={strokeWidth} aria-hidden="true" />;
}

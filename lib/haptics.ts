/**
 * Vibration feedback on supporting phones (Android Chrome; iOS Safari ignores it silently).
 * Follows the sound mute switch so a muted player also gets a quiet phone.
 */
import { sound } from './sound';

const PATTERNS = {
  tap: 8,
  light: 12,
  score: 18,
  big: [20, 40, 30],
  fail: [40, 30, 60],
  countdown: 10,
  go: 35,
} as const;

export type HapticKind = keyof typeof PATTERNS;

export function haptic(kind: HapticKind) {
  if (!sound.enabled || typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  try {
    navigator.vibrate(PATTERNS[kind] as number | number[]);
  } catch {
    /* unsupported */
  }
}

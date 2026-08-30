import { config } from '../config.js';
import { calledRecently } from '../db.js';

export function istMinutes(at: Date): number {
  const istMs = at.getTime() + 5.5 * 3_600_000;
  const ist = new Date(istMs);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

export function isWithinWindows(istMin: number): boolean {
  return config.callWindowsIST.some((w) => istMin >= w.startMin && istMin < w.endMin);
}

export function insideCallingWindow(at: Date): boolean {
  if (config.ignoreCallWindow) return true;
  return isWithinWindows(istMinutes(at));
}

export function nextWindowOpensAt(at: Date): string {
  const m = istMinutes(at);
  for (const w of config.callWindowsIST) {
    if (m < w.startMin) {
      return new Date(at.getTime() + (w.startMin - m) * 60_000).toISOString();
    }
  }
  const first = config.callWindowsIST[0];
  const minsUntilTomorrow = 24 * 60 - m + (first ? first.startMin : 0);
  return new Date(at.getTime() + minsUntilTomorrow * 60_000).toISOString();
}

export async function checkCall(call: { id: string; phone_e164: string }): Promise<string | null> {
  if (!/^\+[1-9]\d{7,14}$/.test(call.phone_e164)) {
    return 'invalid phone number';
  }
  if (await calledRecently(call.phone_e164, config.perNumberCooldownDays, call.id)) {
    return `number already called within ${config.perNumberCooldownDays} days`;
  }
  return null;
}

export function toE164(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) {
    return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : null;
  }
  const bare = digits.replace(/^0+/, '');
  if (/^91\d{10}$/.test(bare)) return `+${bare}`;
  if (/^[6-9]\d{9}$/.test(bare)) return `+91${bare}`;
  return null;
}

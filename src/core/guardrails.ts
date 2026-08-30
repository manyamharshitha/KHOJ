import { config } from '../config.js';
import { calledRecently } from '../db.js';
import { SCRIPT } from './script.js';

/** Minutes past midnight, IST, for any instant. */
export function istMinutes(at: Date): number {
  const istMs = at.getTime() + 5.5 * 3_600_000;
  const ist = new Date(istMs);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

/** Pure: does this IST minute-of-day fall inside a permitted block? */
export function isWithinWindows(istMin: number): boolean {
  return config.callWindowsIST.some((w) => istMin >= w.startMin && istMin < w.endMin);
}

/**
 * As above, but honours the development override. Note that
 * `config.ignoreCallWindow` is read once at import, so flipping the env var at
 * runtime does nothing — test `isWithinWindows` for the schedule itself.
 */
export function insideCallingWindow(at: Date): boolean {
  if (config.ignoreCallWindow) return true;
  return isWithinWindows(istMinutes(at));
}

/** When the next window opens, as an ISO string. */
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

/** Returns a reason string when the call must NOT be placed, else null. */
export function checkCall(call: { id: string; phone_e164: string }): string | null {
  if (!/^\+[1-9]\d{7,14}$/.test(call.phone_e164)) {
    return 'invalid phone number';
  }
  if (calledRecently(call.phone_e164, config.perNumberCooldownDays, call.id)) {
    return `number already called within ${config.perNumberCooldownDays} days`;
  }
  return null;
}

/**
 * Asserted at boot so the disclosure and consent language cannot be edited away
 * by accident. These two sentences are what keep the call outside the definition
 * of unsolicited commercial communication.
 */
export function assertScriptCompliance(): void {
  const opener = SCRIPT.opener.toLowerCase();

  if (!/\bai\b|automated|assistant/.test(opener)) {
    throw new Error('COMPLIANCE: opener must disclose that the caller is an AI');
  }
  if (!opener.includes('recording')) {
    throw new Error('COMPLIANCE: opener must ask for consent to record');
  }
  const promo = ['offer', 'discount', 'deal', 'best price', 'sign up', 'we provide'];
  const allText = [SCRIPT.opener, SCRIPT.close, ...SCRIPT.steps.map((s) => s.ask)]
    .join(' ')
    .toLowerCase();
  for (const p of promo) {
    if (allText.includes(p)) {
      throw new Error(`COMPLIANCE: script contains promotional language: "${p}"`);
    }
  }
}

/** Normalise Indian mobile numbers to E.164. Returns null when unusable. */
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

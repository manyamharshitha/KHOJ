import { timingSafeEqual } from 'node:crypto';
import { firebaseAuth } from '../firebase.js';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export async function verifyFirebaseToken(idToken: string): Promise<SessionUser> {
  const decoded = await firebaseAuth.verifyIdToken(idToken);
  return {
    id: decoded.uid,
    email: decoded.email ?? '',
    name: (decoded.name as string | undefined) ?? null,
    picture: (decoded.picture as string | undefined) ?? null,
  };
}

export function tokenFromRequest(headers: Record<string, unknown>): string | undefined {
  const auth = String(headers.authorization ?? '');
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim() || undefined;
  return undefined;
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

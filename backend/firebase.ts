import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { config } from './config.js';

function buildApp(): App {
  const existing = getApps();
  if (existing[0]) return existing[0];

  if (config.firebaseProjectId && config.firebaseClientEmail && config.firebasePrivateKey) {
    return initializeApp({
      credential: cert({
        projectId: config.firebaseProjectId,
        clientEmail: config.firebaseClientEmail,
        privateKey: config.firebasePrivateKey,
      }),
    });
  }

  return initializeApp();
}

export const firestore: Firestore = getFirestore(buildApp());
export const firebaseAuth: Auth = getAuth(buildApp());

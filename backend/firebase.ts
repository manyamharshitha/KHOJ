import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { config } from './config.js';

// Mock Firestore client for development without real credentials or emulator
class MockQuery {
  where() {
    return this;
  }
  limit() {
    return this;
  }
  orderBy() {
    return this;
  }
  async get() {
    return { docs: [], exists: false, data: () => null };
  }
  async *stream() {
    // Empty async iterator
  }
}

class MockDocRef {
  collection() {
    return new MockQuery();
  }
  doc() {
    return this;
  }
  async get() {
    return { exists: false, data: () => null };
  }
  async set() {
    return;
  }
  async update() {
    return;
  }
  async delete() {
    return;
  }
}

class MockCollectionRef extends MockQuery {
  doc() {
    return new MockDocRef();
  }
  async set() {
    return;
  }
  async update() {
    return;
  }
  async delete() {
    return;
  }
}

class MockFirestore {
  collection() {
    return new MockCollectionRef();
  }
  doc() {
    return new MockDocRef();
  }
}

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

  // No credentials - initialize with dummy project for testing
  console.log('⚠️  Firebase credentials not configured. Using mock Firestore for testing.');
  return initializeApp({ projectId: 'khoj-dev' });
}

const app = buildApp();

export const firestore: Firestore = config.firebaseProjectId 
  ? getFirestore(app) 
  : (new MockFirestore() as unknown as Firestore);
export const firebaseAuth: Auth = getAuth(app);

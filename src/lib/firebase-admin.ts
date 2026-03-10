import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

let _app: App | undefined;
let _auth: Auth | undefined;
let _db: Firestore | undefined;

function getApp(): App {
  if (_app) return _app;
  if (getApps().length) {
    _app = getApps()[0]!;
    return _app;
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.startsWith('{')) {
    const serviceAccount = JSON.parse(raw);
    _app = initializeApp({ credential: cert(serviceAccount) });
  } else {
    // Uses Application Default Credentials (works on GCP)
    const projectId = process.env.GOOGLE_CLOUD_PROJECT
      || process.env.GCLOUD_PROJECT
      || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    _app = initializeApp(projectId ? { projectId } : undefined);
  }
  return _app;
}

export const adminAuth: Auth = new Proxy({} as Auth, {
  get(_, prop) {
    if (!_auth) _auth = getAuth(getApp());
    return (_auth as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export const adminDb: Firestore = new Proxy({} as Firestore, {
  get(_, prop) {
    if (!_db) _db = getFirestore(getApp());
    return (_db as unknown as Record<string | symbol, unknown>)[prop];
  },
});

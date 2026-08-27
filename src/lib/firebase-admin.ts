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
    _app = initializeApp({
      credential: cert(serviceAccount),
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    });
  } else {
    // Uses Application Default Credentials (works on GCP)
    const projectId = process.env.GOOGLE_CLOUD_PROJECT
      || process.env.GCLOUD_PROJECT
      || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    _app = initializeApp({
      ...(projectId ? { projectId } : {}),
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    });
  }
  return _app;
}

/** Short-lived Google access token for server-to-server APIs such as Vertex AI. */
export async function getGoogleAccessToken(): Promise<string> {
  const credential = getApp().options.credential;
  if (!credential) throw new Error('GOOGLE_APPLICATION_CREDENTIALS_UNAVAILABLE');
  const token = await credential.getAccessToken();
  if (!token.access_token) throw new Error('GOOGLE_APPLICATION_CREDENTIALS_UNAVAILABLE');
  return token.access_token;
}

function bindIfFunction(target: object, value: unknown): unknown {
  // Methods pulled off the instance (recursiveDelete, deleteUser, …) must
  // keep that instance as `this`. Calling them through this Proxy otherwise
  // leaves `this` as the empty dummy object and they throw / no-op.
  return typeof value === 'function' ? (value as (...args: never[]) => unknown).bind(target) : value;
}

export const adminAuth: Auth = new Proxy({} as Auth, {
  get(_, prop) {
    if (!_auth) _auth = getAuth(getApp());
    return bindIfFunction(_auth, (_auth as unknown as Record<string | symbol, unknown>)[prop]);
  },
});

export const adminDb: Firestore = new Proxy({} as Firestore, {
  get(_, prop) {
    if (!_db) {
      _db = getFirestore(getApp());
      _db.settings({ ignoreUndefinedProperties: true });
    }
    return bindIfFunction(_db, (_db as unknown as Record<string | symbol, unknown>)[prop]);
  },
});

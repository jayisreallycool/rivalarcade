import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Firestore, type Query, type Transaction } from 'firebase-admin/firestore';
import type { Data, QueryOpts, Row, Store, Tx } from './store';

/** Service account from FIREBASE_SERVICE_ACCOUNT (the JSON key, raw or base64). */
function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const sa = JSON.parse(json);
  return { projectId: sa.project_id, clientEmail: sa.client_email, privateKey: String(sa.private_key).replace(/\\n/g, '\n') };
}

export const firebaseConfigured = () => !!process.env.FIREBASE_SERVICE_ACCOUNT;

let app: App | null = null;
let db: Firestore | null = null;
export function adminApp() {
  if (app) return app;
  const sa = serviceAccount();
  if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
  app = getApps()[0] ?? initializeApp({ credential: cert(sa), projectId: sa.projectId });
  return app;
}
export const adminAuth = () => getAuth(adminApp());
function firestore() {
  if (db) return db;
  db = getFirestore(adminApp());
  db.settings({ ignoreUndefinedProperties: true });
  return db;
}

function buildQuery(fs: Firestore, collection: string, q: QueryOpts): Query {
  let ref: Query = fs.collection(collection);
  for (const [f, op, v] of q.where ?? []) ref = ref.where(f, op, v);
  if (q.orderBy) ref = ref.orderBy(q.orderBy[0], q.orderBy[1]);
  return ref.limit(q.limit);
}

export class FirestoreStore implements Store {
  private fs = firestore();

  async get<T>(path: string) {
    const s = await this.fs.doc(path).get();
    return s.exists ? (s.data() as T) : null;
  }
  async query<T>(collection: string, q: QueryOpts): Promise<Row<T>[]> {
    const s = await buildQuery(this.fs, collection, q).get();
    return s.docs.map((d) => ({ id: d.id, path: d.ref.path, data: d.data() as T }));
  }
  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.fs.runTransaction(async (t: Transaction) => {
      const tx: Tx = {
        get: async <U>(p: string) => {
          const s = await t.get(this.fs.doc(p));
          return s.exists ? (s.data() as U) : null;
        },
        getAll: async <U>(ps: string[]) => {
          if (!ps.length) return [];
          const snaps = await t.getAll(...ps.map((p) => this.fs.doc(p)));
          return snaps.map((s) => (s.exists ? (s.data() as U) : null));
        },
        query: async <U>(c: string, q: QueryOpts) => {
          const s = await t.get(buildQuery(this.fs, c, q));
          return s.docs.map((d) => ({ id: d.id, path: d.ref.path, data: d.data() as U }));
        },
        set: (p, d: Data) => void t.set(this.fs.doc(p), d),
        merge: (p, d: Data) => void t.set(this.fs.doc(p), d, { merge: true }),
        create: (p, d: Data) => void t.create(this.fs.doc(p), d),
        del: (p) => void t.delete(this.fs.doc(p)),
      };
      return fn(tx);
    });
  }
}

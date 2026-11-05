/**
 * Minimal document-store interface the game server is written against. Production uses
 * Firestore (firestore-store.ts); tests and local runs use the in-memory store below, which
 * enforces Firestore's transaction rules (all reads before any write, create() fails if the
 * document exists) so logic that passes here behaves the same on Firestore.
 */

export type Data = Record<string, unknown>;
export type Op = '==' | '<=' | '>=' | '<' | '>' | 'in' | 'array-contains';
export type Where = [field: string, op: Op, value: unknown];
export interface QueryOpts {
  where?: Where[];
  orderBy?: [field: string, dir: 'asc' | 'desc'];
  limit: number;
}
export interface Row<T = Data> {
  id: string;
  path: string;
  data: T;
}

export interface Tx {
  get<T = Data>(path: string): Promise<T | null>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAll<T = any>(paths: string[]): Promise<(T | null)[]>;
  query<T = Data>(collection: string, q: QueryOpts): Promise<Row<T>[]>;
  /** Replace the whole document. */
  set(path: string, data: Data): void;
  /** Shallow-merge fields into the document (creates it if missing). */
  merge(path: string, data: Data): void;
  /** Create; the whole transaction fails if the document already exists. */
  create(path: string, data: Data): void;
  del(path: string): void;
}

export interface Store {
  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  get<T = Data>(path: string): Promise<T | null>;
  query<T = Data>(collection: string, q: QueryOpts): Promise<Row<T>[]>;
}

export class StoreError extends Error {}

// ------------------------------------------------------------------------------------- memory

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

function matches(doc: Data, w: Where[]) {
  return w.every(([f, op, v]) => {
    const x = doc[f] as never;
    switch (op) {
      case '==':
        return x === v;
      case '<=':
        return x != null && x <= (v as never);
      case '>=':
        return x != null && x >= (v as never);
      case '<':
        return x != null && x < (v as never);
      case '>':
        return x != null && x > (v as never);
      case 'in':
        return (v as unknown[]).includes(x);
      case 'array-contains':
        return Array.isArray(x) && (x as unknown[]).includes(v);
    }
  });
}

export class MemoryStore implements Store {
  docs = new Map<string, Data>();
  private lock: Promise<unknown> = Promise.resolve();

  private parentOf(path: string) {
    return path.slice(0, path.lastIndexOf('/'));
  }

  private doQuery<T>(collection: string, q: QueryOpts): Row<T>[] {
    let rows: Row<T>[] = [];
    for (const [path, data] of this.docs) {
      if (this.parentOf(path) !== collection) continue;
      if (q.where && !matches(data, q.where)) continue;
      rows.push({ id: path.slice(collection.length + 1), path, data: clone(data) as T });
    }
    if (q.orderBy) {
      const [f, dir] = q.orderBy;
      rows = rows.filter((r) => (r.data as Data)[f] != null);
      rows.sort((a, b) => {
        const x = (a.data as Data)[f] as number;
        const y = (b.data as Data)[f] as number;
        return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1);
      });
    }
    return rows.slice(0, q.limit);
  }

  async get<T>(path: string) {
    return (clone(this.docs.get(path)) as T) ?? null;
  }
  async query<T>(collection: string, q: QueryOpts) {
    return this.doQuery<T>(collection, q);
  }

  async run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const prev = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((r) => (release = r));
    await prev;
    try {
      const writes: [string, 'set' | 'merge' | 'create' | 'del', Data | null][] = [];
      const guard = () => {
        if (writes.length) throw new StoreError('read after write in transaction');
      };
      const tx: Tx = {
        get: async <U>(p: string) => (guard(), (clone(this.docs.get(p)) as U) ?? null),
        getAll: async <U>(ps: string[]) => (guard(), ps.map((p) => (clone(this.docs.get(p)) as U) ?? null)),
        query: async <U>(c: string, q: QueryOpts) => (guard(), this.doQuery<U>(c, q)),
        set: (p, d) => void writes.push([p, 'set', clone(d)]),
        merge: (p, d) => void writes.push([p, 'merge', clone(d)]),
        create: (p, d) => void writes.push([p, 'create', clone(d)]),
        del: (p) => void writes.push([p, 'del', null]),
      };
      const out = await fn(tx);
      // validate, then apply atomically
      const staged = new Map(this.docs);
      for (const [p, kind, d] of writes) {
        if (kind === 'create' && staged.has(p)) throw new StoreError(`already exists: ${p}`);
        if (kind === 'del') staged.delete(p);
        else if (kind === 'merge') staged.set(p, { ...(staged.get(p) ?? {}), ...stripUndefined(d!) });
        else staged.set(p, stripUndefined(d!));
      }
      this.docs = staged;
      return out;
    } finally {
      release();
    }
  }
}

function stripUndefined(d: Data): Data {
  const o: Data = {};
  for (const [k, v] of Object.entries(d)) if (v !== undefined) o[k] = v;
  return o;
}

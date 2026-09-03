/**
 * The slice of the Firestore Admin API the agent OAuth store uses, in
 * memory: document get/set/update/delete and a serial runTransaction. Just
 * enough to exercise the real store and grant code without a database.
 */

type Doc = Record<string, unknown>;

class FakeSnapshot {
  constructor(readonly id: string, private readonly value: Doc | undefined) {}
  get exists() {
    return this.value !== undefined;
  }
  data() {
    return this.value ? { ...this.value } : undefined;
  }
}

export class FakeFirestore {
  readonly docs = new Map<string, Doc>();

  doc(path: string) {
    return new FakeDocRef(this, path);
  }

  collection(path: string) {
    return {
      doc: (id: string) => new FakeDocRef(this, `${path}/${id}`),
    };
  }

  async runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    return fn(new FakeTransaction(this));
  }

  /** Test helper: every document whose path starts with the prefix. */
  under(prefix: string): Array<{ path: string; data: Doc }> {
    return Array.from(this.docs.entries())
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, data]) => ({ path, data }));
  }
}

class FakeDocRef {
  constructor(private readonly db: FakeFirestore, readonly path: string) {}
  get id() {
    return this.path.split('/').pop() as string;
  }
  async get() {
    return new FakeSnapshot(this.id, this.db.docs.get(this.path));
  }
  async set(value: Doc) {
    this.db.docs.set(this.path, { ...value });
  }
  async update(patch: Doc) {
    const current = this.db.docs.get(this.path);
    if (!current) throw new Error(`NOT_FOUND: no document at ${this.path}`);
    this.db.docs.set(this.path, { ...current, ...patch });
  }
  async delete() {
    this.db.docs.delete(this.path);
  }
}

class FakeTransaction {
  constructor(private readonly db: FakeFirestore) {}
  async get(ref: FakeDocRef) {
    return ref.get();
  }
  update(ref: FakeDocRef, patch: Doc) {
    const current = this.db.docs.get(ref.path);
    if (!current) throw new Error(`NOT_FOUND: no document at ${ref.path}`);
    this.db.docs.set(ref.path, { ...current, ...patch });
  }
  delete(ref: FakeDocRef) {
    this.db.docs.delete(ref.path);
  }
}

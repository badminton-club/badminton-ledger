/**
 * A tiny in-memory fake of the `firebase/firestore` modular SDK, wired in for
 * all tests via the `moduleNameMapper` override in package.json's "jest"
 * config. Every test file that (directly or transitively, via
 * `services/firebase/client`) imports `firebase/firestore` gets this fake
 * instead of the real SDK — no network, no emulator, no per-file `jest.mock`
 * boilerplate needed.
 *
 * It only implements what this app actually uses (see the named exports
 * below): doc/collection refs, get/add/set/update/delete, query constraints
 * (where/orderBy/limit), transactions, batched writes, and the
 * serverTimestamp/increment/arrayUnion/arrayRemove sentinels. Everything is
 * stored as plain JS objects keyed by full path in a single Map, reset
 * between tests with `__resetFirestore()`.
 *
 * Extra `__`-prefixed exports below are test-only controls — not part of the
 * real firebase/firestore API, so only import them from test files, never
 * from app code.
 */

// ─── Sentinels ──────────────────────────────────────────────────────────────

interface ServerTimestampSentinel { __sentinel: 'serverTimestamp'; }
interface IncrementSentinel { __sentinel: 'increment'; n: number; }
interface ArrayUnionSentinel { __sentinel: 'arrayUnion'; items: unknown[]; }
interface ArrayRemoveSentinel { __sentinel: 'arrayRemove'; items: unknown[]; }
type Sentinel = ServerTimestampSentinel | IncrementSentinel | ArrayUnionSentinel | ArrayRemoveSentinel;

function isSentinel(value: unknown): value is Sentinel {
  return !!value && typeof value === 'object' && '__sentinel' in (value as object);
}

export function serverTimestamp(): ServerTimestampSentinel {
  return { __sentinel: 'serverTimestamp' };
}
export function increment(n: number): IncrementSentinel {
  return { __sentinel: 'increment', n };
}
export function arrayUnion(...items: unknown[]): ArrayUnionSentinel {
  return { __sentinel: 'arrayUnion', items };
}
export function arrayRemove(...items: unknown[]): ArrayRemoveSentinel {
  return { __sentinel: 'arrayRemove', items };
}

// ─── Timestamp ──────────────────────────────────────────────────────────────

export class Timestamp {
  constructor(public readonly seconds: number, public readonly nanoseconds: number) {}

  static now(): Timestamp {
    return Timestamp.fromDate(new Date());
  }
  static fromDate(date: Date): Timestamp {
    const ms = date.getTime();
    return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }
  toDate(): Date {
    return new Date(this.seconds * 1000 + this.nanoseconds / 1e6);
  }
  toMillis(): number {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6);
  }
  isEqual(other: unknown): boolean {
    return other instanceof Timestamp && other.seconds === this.seconds && other.nanoseconds === this.nanoseconds;
  }
}

// ─── Refs ───────────────────────────────────────────────────────────────────

export interface FakeFirestoreHandle { __type: 'firestore'; }
export interface FakeCollectionRef { __type: 'collection'; path: string; id: string; firestore: FakeFirestoreHandle; }
export interface FakeDocRef { __type: 'doc'; path: string; id: string; firestore: FakeFirestoreHandle; }

const FIRESTORE_HANDLE: FakeFirestoreHandle = { __type: 'firestore' };

export function getFirestore(): FakeFirestoreHandle {
  return FIRESTORE_HANDLE;
}

let autoId = 0;
function generateId(): string {
  autoId += 1;
  return `auto-id-${autoId}`;
}

function isFirestoreHandle(value: unknown): value is FakeFirestoreHandle {
  return !!value && (value as { __type?: string }).__type === 'firestore';
}
function isCollectionRef(value: unknown): value is FakeCollectionRef {
  return !!value && (value as { __type?: string }).__type === 'collection';
}

export function collection(parent: FakeFirestoreHandle, ...segments: string[]): FakeCollectionRef {
  if (!isFirestoreHandle(parent)) {
    throw new Error('[fakeFirestore] collection() only supports collection(db, ...segments) in this app.');
  }
  const path = segments.join('/');
  return { __type: 'collection', path, id: segments[segments.length - 1], firestore: parent };
}

/** Supports both `doc(db, ...segments)` and `doc(collectionRef, id?)` (auto-ID when omitted). */
export function doc(parent: FakeFirestoreHandle | FakeCollectionRef, ...rest: string[]): FakeDocRef {
  if (isCollectionRef(parent)) {
    const id = rest[0] ?? generateId();
    return { __type: 'doc', path: `${parent.path}/${id}`, id, firestore: parent.firestore };
  }
  if (isFirestoreHandle(parent)) {
    const id = rest[rest.length - 1];
    return { __type: 'doc', path: rest.join('/'), id, firestore: parent };
  }
  throw new Error('[fakeFirestore] doc() called with an unrecognized parent ref.');
}

// ─── Query constraints ──────────────────────────────────────────────────────

interface WhereConstraint { __type: 'where'; field: string; op: string; value: unknown; }
interface OrderByConstraint { __type: 'orderBy'; field: string; direction: 'asc' | 'desc'; }
interface LimitConstraint { __type: 'limit'; n: number; }
type QueryConstraint = WhereConstraint | OrderByConstraint | LimitConstraint;

export function where(field: string, op: string, value: unknown): WhereConstraint {
  return { __type: 'where', field, op, value };
}
export function orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): OrderByConstraint {
  return { __type: 'orderBy', field, direction };
}
export function limit(n: number): LimitConstraint {
  return { __type: 'limit', n };
}

interface FakeQuery { __type: 'query'; base: FakeCollectionRef; constraints: QueryConstraint[]; }

export function query(base: FakeCollectionRef, ...constraints: QueryConstraint[]): FakeQuery {
  return { __type: 'query', base, constraints };
}

// ─── Store ──────────────────────────────────────────────────────────────────

const store = new Map<string, Record<string, unknown>>();

function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  // Timestamp/Date are treated as immutable value objects here — round-tripping them
  // through JSON would silently strip their class identity, breaking `instanceof`
  // checks the app relies on (e.g. `services/firebase/utils.ts`'s `toJSDate`).
  if (value instanceof Timestamp) return value;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (Array.isArray(value)) return value.map(v => clone(v)) as unknown as T;
  const result: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    result[key] = clone(v);
  }
  return result as T;
}

function directChildren(collectionPath: string): Array<{ id: string; path: string; data: Record<string, unknown> }> {
  const prefix = `${collectionPath}/`;
  const results: Array<{ id: string; path: string; data: Record<string, unknown> }> = [];
  store.forEach((data, path) => {
    if (!path.startsWith(prefix)) return;
    const rest = path.slice(prefix.length);
    if (rest.includes('/')) return; // not a direct child
    results.push({ id: rest, path, data });
  });
  return results;
}

function getValueAt(data: Record<string, unknown>, field: string): unknown {
  return data[field];
}

/** Unwraps a Timestamp to millis so relational operators (>, >=, <, <=) compare correctly. */
function toComparable(value: unknown): unknown {
  return value instanceof Timestamp ? value.toMillis() : value;
}

function matchesWhere(data: Record<string, unknown>, c: WhereConstraint): boolean {
  const actual = toComparable(getValueAt(data, c.field));
  const expected = toComparable(c.value);
  switch (c.op) {
    case '==': return actual === expected;
    case '!=': return actual !== expected;
    case '>': return (actual as any) > (expected as any);
    case '>=': return (actual as any) >= (expected as any);
    case '<': return (actual as any) < (expected as any);
    case '<=': return (actual as any) <= (expected as any);
    case 'in': return Array.isArray(c.value) && (c.value as unknown[]).includes(getValueAt(data, c.field));
    case 'array-contains': return Array.isArray(actual) && (actual as unknown[]).includes(c.value);
    case 'array-contains-any':
      return Array.isArray(actual) && Array.isArray(c.value) &&
        (actual as unknown[]).some(v => (c.value as unknown[]).includes(v));
    default:
      throw new Error(`[fakeFirestore] Unsupported where() operator: ${c.op}`);
  }
}

function compareForOrder(a: unknown, b: unknown): number {
  const av = a instanceof Timestamp ? a.toMillis() : a;
  const bv = b instanceof Timestamp ? b.toMillis() : b;
  if (av === bv) return 0;
  if (av === undefined || av === null) return -1;
  if (bv === undefined || bv === null) return 1;
  return av > bv ? 1 : -1;
}

function runQuery(q: FakeQuery): Array<{ id: string; path: string; data: Record<string, unknown> }> {
  let results = directChildren(q.base.path);
  for (const c of q.constraints) {
    if (c.__type === 'where') {
      results = results.filter(r => matchesWhere(r.data, c));
    }
  }
  const orderConstraints = q.constraints.filter((c): c is OrderByConstraint => c.__type === 'orderBy');
  if (orderConstraints.length) {
    results = [...results].sort((a, b) => {
      for (const oc of orderConstraints) {
        const cmp = compareForOrder(getValueAt(a.data, oc.field), getValueAt(b.data, oc.field));
        if (cmp !== 0) return oc.direction === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  }
  const limitConstraint = q.constraints.find((c): c is LimitConstraint => c.__type === 'limit');
  if (limitConstraint) {
    results = results.slice(0, limitConstraint.n);
  }
  return results;
}

// ─── Snapshots ──────────────────────────────────────────────────────────────

function makeDocSnap(ref: FakeDocRef) {
  const data = store.get(ref.path);
  return {
    id: ref.id,
    ref,
    exists: () => data !== undefined,
    data: () => (data === undefined ? undefined : clone(data)),
  };
}

function makeQueryDocSnap(id: string, path: string, data: Record<string, unknown>) {
  return {
    id,
    ref: { __type: 'doc', path, id, firestore: FIRESTORE_HANDLE } as FakeDocRef,
    exists: () => true,
    data: () => clone(data),
  };
}

function makeQuerySnapshot(entries: Array<{ id: string; path: string; data: Record<string, unknown> }>) {
  const docs = entries.map(e => makeQueryDocSnap(e.id, e.path, e.data));
  return {
    docs,
    size: docs.length,
    empty: docs.length === 0,
    forEach: (cb: (d: (typeof docs)[number]) => void) => docs.forEach(cb),
  };
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function getDoc(ref: FakeDocRef) {
  return makeDocSnap(ref);
}

export async function getDocs(target: FakeCollectionRef | FakeQuery) {
  if ((target as FakeQuery).__type === 'query') {
    return makeQuerySnapshot(runQuery(target as FakeQuery));
  }
  const coll = target as FakeCollectionRef;
  return makeQuerySnapshot(directChildren(coll.path));
}

// ─── Writes ─────────────────────────────────────────────────────────────────

/** Resolves sentinels (serverTimestamp/increment/arrayUnion/arrayRemove) against the current stored value. */
function resolveField(existing: Record<string, unknown> | undefined, key: string, value: unknown): unknown {
  if (!isSentinel(value)) return value;
  const current = existing?.[key];
  switch (value.__sentinel) {
    case 'serverTimestamp':
      return Timestamp.now();
    case 'increment':
      return (typeof current === 'number' ? current : 0) + value.n;
    case 'arrayUnion': {
      const arr = Array.isArray(current) ? [...current] : [];
      for (const item of value.items) if (!arr.includes(item)) arr.push(item);
      return arr;
    }
    case 'arrayRemove': {
      const arr = Array.isArray(current) ? current : [];
      return arr.filter((item: unknown) => !value.items.includes(item));
    }
    default:
      return value;
  }
}

function resolveFields(existing: Record<string, unknown> | undefined, patch: Record<string, unknown>): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    resolved[key] = resolveField(existing, key, value);
  }
  return resolved;
}

function applySet(ref: FakeDocRef, data: Record<string, unknown>, options?: { merge?: boolean }) {
  const existing = store.get(ref.path);
  const resolved = resolveFields(existing, data);
  if (options?.merge && existing) {
    store.set(ref.path, { ...existing, ...resolved });
  } else {
    store.set(ref.path, resolved);
  }
}

/**
 * Merges into an existing doc, matching real Firestore's shape. Unlike the
 * real SDK (which throws on a missing doc), this creates it if absent —
 * chosen deliberately to keep test setup lightweight; tests that care about
 * "doc must already exist" should assert via `__getDocData`/`exists()` checks
 * on a prior `getDoc` instead of relying on this throwing.
 */
function applyUpdate(ref: FakeDocRef, data: Record<string, unknown>) {
  const existing = store.get(ref.path);
  const resolved = resolveFields(existing, data);
  store.set(ref.path, { ...(existing ?? {}), ...resolved });
}

function applyDelete(ref: FakeDocRef) {
  store.delete(ref.path);
}

export async function addDoc(coll: FakeCollectionRef, data: Record<string, unknown>): Promise<FakeDocRef> {
  const ref = doc(coll);
  applySet(ref, data);
  return ref;
}

export async function setDoc(ref: FakeDocRef, data: Record<string, unknown>, options?: { merge?: boolean }): Promise<void> {
  applySet(ref, data, options);
}

export async function updateDoc(ref: FakeDocRef, data: Record<string, unknown>): Promise<void> {
  applyUpdate(ref, data);
}

export async function deleteDoc(ref: FakeDocRef): Promise<void> {
  applyDelete(ref);
}

// ─── Transactions & batched writes ──────────────────────────────────────────
//
// Both mimic real Firestore's "reads happen against live state, writes are
// queued and applied atomically at the end" model closely enough for this
// app's usage (which — as verified during code review — always reads before
// writing within a transaction).

export async function runTransaction<T>(
  _db: FakeFirestoreHandle,
  updateFunction: (tx: {
    get: (ref: FakeDocRef) => Promise<ReturnType<typeof makeDocSnap>>;
    set: (ref: FakeDocRef, data: Record<string, unknown>, options?: { merge?: boolean }) => void;
    update: (ref: FakeDocRef, data: Record<string, unknown>) => void;
    delete: (ref: FakeDocRef) => void;
  }) => Promise<T>
): Promise<T> {
  const pending: Array<() => void> = [];
  const tx = {
    get: (ref: FakeDocRef) => getDoc(ref),
    set: (ref: FakeDocRef, data: Record<string, unknown>, options?: { merge?: boolean }) => {
      pending.push(() => applySet(ref, data, options));
    },
    update: (ref: FakeDocRef, data: Record<string, unknown>) => {
      pending.push(() => applyUpdate(ref, data));
    },
    delete: (ref: FakeDocRef) => {
      pending.push(() => applyDelete(ref));
    },
  };
  const result = await updateFunction(tx);
  pending.forEach(write => write());
  return result;
}

export function writeBatch(_db: FakeFirestoreHandle) {
  const pending: Array<() => void> = [];
  const batch = {
    set(ref: FakeDocRef, data: Record<string, unknown>, options?: { merge?: boolean }) {
      pending.push(() => applySet(ref, data, options));
      return batch;
    },
    update(ref: FakeDocRef, data: Record<string, unknown>) {
      pending.push(() => applyUpdate(ref, data));
      return batch;
    },
    delete(ref: FakeDocRef) {
      pending.push(() => applyDelete(ref));
      return batch;
    },
    async commit() {
      pending.forEach(write => write());
    },
  };
  return batch;
}

// ─── Realtime listeners ─────────────────────────────────────────────────────
//
// Simplified: fires once (asynchronously, matching real onSnapshot's
// microtask-later behavior) with the query's current matches, and never
// again — sufficient for testing the "attach a listener and resolve" flow
// (e.g. `subscribeToPlayers`). No live re-fire on later store writes.

export function onSnapshot(
  target: FakeCollectionRef | FakeQuery,
  onNext: (snap: ReturnType<typeof makeQuerySnapshot>) => void,
  onError?: (err: Error) => void
): () => void {
  let cancelled = false;
  Promise.resolve().then(() => {
    if (cancelled) return;
    try {
      const entries = (target as FakeQuery).__type === 'query'
        ? runQuery(target as FakeQuery)
        : directChildren((target as FakeCollectionRef).path);
      onNext(makeQuerySnapshot(entries));
    } catch (err) {
      onError?.(err as Error);
    }
  });
  return () => { cancelled = true; };
}

// ─── Test-only controls ─────────────────────────────────────────────────────

/** Clears all stored documents and resets auto-ID generation. Call in `beforeEach`. */
export function __resetFirestore(): void {
  store.clear();
  autoId = 0;
}

/** Seeds a document directly at a full slash-joined path, bypassing sentinel resolution. */
export function __seedDoc(path: string, data: Record<string, unknown>): void {
  store.set(path, clone(data));
}

/** Reads a document's raw current data at a full slash-joined path (or undefined if absent). */
export function __getDocData(path: string): Record<string, unknown> | undefined {
  const data = store.get(path);
  return data === undefined ? undefined : clone(data);
}

/** Returns every currently stored path — handy for debugging a failing test. */
export function __getAllPaths(): string[] {
  return [...store.keys()];
}

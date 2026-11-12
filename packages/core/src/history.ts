import { SoundorError } from './errors';

/** Opt-in recording; the outermost History gesture or transaction owns its label. */
export type HistoryOption = boolean | { readonly label: string };
export interface HistoryOptions {
  readonly history?: HistoryOption;
}
export interface HistoryStatus {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
}

export class TransactionAbortedError extends SoundorError {
  constructor(cause: unknown) {
    super('StateHistory transaction aborted after a failed Soundor operation', {
      code: 'TRANSACTION_ABORTED',
      cause,
    });
    this.name = 'TransactionAbortedError';
  }
}

/** Runtime storage adapter. Preparation allocates; install must only replace prepared storage. */
export interface HistoryField {
  readonly id: string;
  readonly label: string;
  read(): unknown;
  equal(a: unknown, b: unknown): boolean;
  prepare(value: unknown): { install(): void; notify(): void };
}
interface Change {
  readonly id: string;
  readonly before: unknown;
  readonly after: unknown;
}
interface Entry {
  readonly label: string;
  readonly changes: readonly Change[];
  readonly bytes: number;
}
interface Gesture {
  depth: number;
  label: string | null;
  readonly before: unknown;
  edited: boolean;
}
interface Transaction {
  readonly label: string;
  readonly values: Map<string, unknown>;
  failed: boolean;
  cause: unknown;
}
const emptyStatus: HistoryStatus = Object.freeze({
  canUndo: false,
  canRedo: false,
  undoLabel: null,
  redoLabel: null,
});

function label(
  options: HistoryOptions | undefined,
  fallback: string,
): string | null {
  if (options === undefined) return null;
  if (
    options === null ||
    typeof options !== 'object' ||
    Object.keys(options).some((k) => k !== 'history')
  )
    throw new TypeError('Expected History options');
  const value = options.history;
  if (value === undefined || value === false) return null;
  if (value === true) return fallback;
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof value.label === 'string' &&
    value.label.length > 0 &&
    Object.keys(value).length === 1
  )
    return value.label;
  throw new TypeError('history must be boolean or { label: string }');
}
function synchronous(value: unknown): void {
  if (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  )
    throw new TypeError('StateHistory transactions must be synchronous');
}

/** One application-owned manager. Entries hold stable field IDs and detached values, never actions. */
export class StateHistory {
  readonly #fields = new Map<string, HistoryField>();
  readonly #gestures = new Map<string, Gesture>();
  readonly #listeners = new Set<(status: HistoryStatus) => void>();
  #undo: Entry[] = [];
  #redo: Entry[] = [];
  #transaction: Transaction | undefined;
  #status = emptyStatus;
  constructor(
    readonly maxEntries = 100,
    readonly maxBytes = 16 * 1024 * 1024,
  ) {
    if (
      !Number.isInteger(maxEntries) ||
      maxEntries < 1 ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1
    )
      throw new RangeError('StateHistory limits must be positive integers');
  }
  register(field: HistoryField): void {
    if (this.#fields.has(field.id))
      throw new Error(`Duplicate History field '${field.id}'`);
    this.#fields.set(field.id, field);
  }
  read(id: string): unknown {
    return this.#transaction?.values.has(id)
      ? this.#transaction.values.get(id)
      : this.field(id).read();
  }
  /** Also wraps updater evaluation and validation, so caught failures poison a transaction. */
  edit(id: string, compute: () => unknown, options?: HistoryOptions): void {
    this.operation(() => {
      const field = this.field(id);
      const recording = label(options, `Change ${field.label}`);
      const gesture = this.#gestures.get(id);
      if (this.#transaction && gesture?.label !== null && gesture !== undefined)
        throw new Error(`Field '${id}' belongs to a History gesture`);
      const value = compute();
      const before = this.read(id);
      if (field.equal(before, value)) return;
      if (this.#transaction) {
        this.#transaction.values.set(id, value);
        return;
      }
      const changes = [{ id, before, after: value }];
      const wasEdited = gesture?.edited ?? false;
      if (gesture?.label) gesture.edited = true;
      try {
        this.commit(
          changes,
          gesture?.label ? null : recording,
          undefined,
          Boolean(gesture?.label),
        );
      } catch (error) {
        if (gesture) gesture.edited = wasEdited;
        throw error;
      }
    });
  }
  beginGesture(id: string, options?: HistoryOptions): void {
    this.operation(() => {
      if (this.#transaction)
        throw new Error('Cannot begin a gesture inside a transaction');
      const field = this.field(id);
      const recording = label(options, `Change ${field.label}`);
      const gesture = this.#gestures.get(id);
      if (gesture) {
        gesture.depth++;
        return;
      }
      this.#gestures.set(id, {
        depth: 1,
        label: recording,
        before: field.read(),
        edited: false,
      });
    });
  }
  endGesture(id: string): void {
    this.operation(() => {
      if (this.#transaction)
        throw new Error('Cannot end a gesture inside a transaction');
      const gesture = this.#gestures.get(id);
      if (!gesture || gesture.depth > 1) {
        if (gesture) gesture.depth--;
        return;
      }
      const field = this.field(id);
      const after = field.read();
      // Prepare the entry before releasing ownership, so allocation failure is retryable.
      const next =
        gesture.label && gesture.edited && !field.equal(gesture.before, after)
          ? this.append(
              this.entry(gesture.label, [
                { id, before: gesture.before, after },
              ]),
            )
          : null;
      this.#gestures.delete(id);
      if (next) {
        this.#undo = next;
        this.#redo = [];
        this.notify(true);
      }
    });
  }
  cancelGesture(id: string): void {
    this.#gestures.delete(id);
  }
  /** Cancel unfinished recordings on editor teardown; committed entries survive. */
  cancelGestures(): void {
    this.#gestures.clear();
  }
  /** Used by restoration before application restoration callbacks. */
  clear = (): void => {
    this.operation(() => {
      if (this.#transaction)
        throw new Error('Cannot clear History inside a transaction');
      for (const gesture of this.#gestures.values()) {
        gesture.label = null;
        gesture.edited = false;
      }
      const changed = this.#undo.length > 0 || this.#redo.length > 0;
      this.#undo = [];
      this.#redo = [];
      this.notify(changed);
    });
  };
  transaction<T>(
    name: string,
    callback: () => T & (T extends PromiseLike<unknown> ? never : unknown),
  ): T {
    const outer = this.#transaction;
    try {
      if (
        typeof name !== 'string' ||
        name.length === 0 ||
        typeof callback !== 'function'
      )
        throw new TypeError(
          'transaction expects a label and synchronous callback',
        );
      const txn = outer ?? {
        label: name,
        values: new Map<string, unknown>(),
        failed: false,
        cause: undefined,
      };
      this.#transaction = txn;
      const value = callback();
      synchronous(value);
      if (txn.failed) throw new TransactionAbortedError(txn.cause);
      if (!outer) {
        const changes = [...txn.values]
          .map(([id, after]) => ({ id, before: this.field(id).read(), after }))
          .filter((c) => !this.field(c.id).equal(c.before, c.after));
        this.#transaction = undefined;
        this.commit(changes, txn.label);
      }
      return value;
    } catch (error) {
      this.poison(error);
      throw error;
    } finally {
      if (!outer) this.#transaction = undefined;
    }
  }
  canUndo = (): boolean => this.#status.canUndo;
  canRedo = (): boolean => this.#status.canRedo;
  undoLabel = (): string | null => this.#status.undoLabel;
  redoLabel = (): string | null => this.#status.redoLabel;
  snapshot = (): HistoryStatus => this.#status;
  subscribe = (listener: (status: HistoryStatus) => void): (() => void) => {
    if (typeof listener !== 'function')
      throw new TypeError('subscribe expects a function');
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  undo = (): void => this.replay(false);
  redo = (): void => this.replay(true);
  private replay(redo: boolean): void {
    this.operation(() => {
      if (this.#transaction)
        throw new Error('Cannot replay History inside a transaction');
      const source = redo ? this.#redo : this.#undo;
      const entry = source.at(-1);
      if (!entry) return;
      for (const c of entry.changes)
        if (this.#gestures.get(c.id)?.label)
          throw new Error(`Field '${c.id}' belongs to a History gesture`);
      const changes = entry.changes.map((c) => ({
        id: c.id,
        before: this.field(c.id).read(),
        after: redo ? c.after : c.before,
      }));
      const remaining = source.slice(0, -1);
      const destination = [...(redo ? this.#undo : this.#redo), entry];
      this.commit(changes, null, () => {
        if (redo) {
          this.#redo = remaining;
          this.#undo = destination;
        } else {
          this.#undo = remaining;
          this.#redo = destination;
        }
      });
    });
  }
  private field(id: string): HistoryField {
    const field = this.#fields.get(id);
    if (!field) throw new Error(`Unknown History field '${id}'`);
    return field;
  }
  private entry(name: string, changes: readonly Change[]): Entry {
    return {
      label: name,
      changes,
      bytes: new TextEncoder().encode(
        JSON.stringify({ name, changes }, (_k, v: unknown) =>
          typeof v === 'bigint' ? v.toString() : v,
        ),
      ).length,
    };
  }
  private append(entry: Entry): Entry[] {
    const next = [...this.#undo, entry];
    let bytes = next.reduce((sum, e) => sum + e.bytes, 0);
    while (next.length > this.maxEntries || bytes > this.maxBytes)
      bytes -= next.shift()!.bytes;
    return next;
  }
  private commit(
    changes: readonly Change[],
    name: string | null,
    updateStacks?: () => void,
    preserveRedo = false,
  ): void {
    const actual = changes.filter(
      (c) => !this.field(c.id).equal(c.before, c.after),
    );
    const prepared = actual.map((c) => this.field(c.id).prepare(c.after));
    const next =
      name && actual.length ? this.append(this.entry(name, actual)) : null;
    const clearRedo =
      actual.length > 0 &&
      !preserveRedo &&
      updateStacks === undefined &&
      this.#redo.length > 0;
    // No validation, copying, or user callbacks during installation.
    for (const p of prepared) p.install();
    if (next) {
      this.#undo = next;
      this.#redo = [];
    }
    if (clearRedo) this.#redo = [];
    updateStacks?.();
    try {
      for (const p of prepared) p.notify();
    } finally {
      this.notify(next !== null || clearRedo || updateStacks !== undefined);
    }
  }
  private poison(cause: unknown): void {
    if (this.#transaction && !this.#transaction.failed) {
      this.#transaction.failed = true;
      this.#transaction.cause = cause;
    }
  }
  editGuard<T>(callback: () => T): T {
    return this.operation(callback);
  }
  private operation<T>(callback: () => T): T {
    try {
      return callback();
    } catch (error) {
      this.poison(error);
      throw error;
    }
  }
  private notify(force = false): void {
    const next: HistoryStatus = Object.freeze({
      canUndo: this.#undo.length > 0,
      canRedo: this.#redo.length > 0,
      undoLabel: this.#undo.at(-1)?.label ?? null,
      redoLabel: this.#redo.at(-1)?.label ?? null,
    });
    if (
      !force &&
      Object.keys(next).every(
        (k) =>
          next[k as keyof HistoryStatus] ===
          this.#status[k as keyof HistoryStatus],
      )
    )
      return;
    this.#status = next;
    for (const listener of [...this.#listeners]) {
      try {
        listener(next);
      } catch (error) {
        console.error(error);
      }
    }
  }
}

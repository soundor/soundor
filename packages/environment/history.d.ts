/** Undo/redo of Soundor parameter and persistent-state edits, owned by the processor/application. */
declare module 'soundor:history' {
  /** Recording is opt-in. Outermost gesture/transaction labels take precedence. */
  export type HistoryOption = boolean | { readonly label: string };
  /** Options shared by field setters and gesture starts. */
  export interface HistoryOptions {
    readonly history?: HistoryOption;
  }
  /** Immutable snapshot of the next available actions. */
  export interface HistoryStatus {
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    readonly undoLabel: string | null;
    readonly redoLabel: string | null;
  }
  export interface History {
    /** Apply the next entry's original values. Rejects conflicts with active History gestures. */
    undo(): void;
    /** Reapply the next entry's final values. */
    redo(): void;
    canUndo(): boolean;
    canRedo(): boolean;
    undoLabel(): string | null;
    redoLabel(): string | null;
    /** Stable immutable status snapshot, suitable for useSyncExternalStore. */
    snapshot(): HistoryStatus;
    /** Subscribe to changes in availability or labels; does not call immediately. */
    subscribe(listener: (status: HistoryStatus) => void): () => void;
    /** Clear entries and invalidate unfinished History recordings. Never persists History. */
    clear(): void;
    /** Stage synchronous writes, publishing all values on success as one entry. Nested calls share the outer buffer. */
    transaction<T>(
      label: string,
      callback: () => T & (T extends PromiseLike<unknown> ? never : unknown),
    ): T;
  }
  /** The same manager used by native code; survives editor recreation. */
  export const history: History;
}

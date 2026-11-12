/** Undo/redo of Soundor parameter and persistent-state edits, owned by the processor/application. */
declare module 'soundor:state-history' {
  /** Recording is opt-in. Outermost gesture/transaction labels take precedence. @since next */
  export type HistoryOption = boolean | { readonly label: string };
  /** Options shared by field setters and gesture starts. @since next */
  export interface HistoryOptions {
    /** Whether to record what the write does, and under what label. @since next */
    readonly history?: HistoryOption;
  }
  /** Immutable snapshot of the next available actions. @since next */
  export interface HistoryStatus {
    /** Whether an entry is available to apply. @since next */
    readonly canUndo: boolean;
    /** Whether an entry is available to reapply. @since next */
    readonly canRedo: boolean;
    /** The outermost recorded gesture's label, or null. @since next */
    readonly undoLabel: string | null;
    /** The next entry's label, or null. @since next */
    readonly redoLabel: string | null;
  }
  /** Undo/redo of the processor's recorded edits, surviving editor recreation. @since next */
  export interface StateHistory {
    /** Apply the next entry's original values. Rejects conflicts with active History gestures. @since next */
    undo(): void;
    /** Reapply the next entry's final values. @since next */
    redo(): void;
    /** Whether undo() would apply an entry. @since next */
    canUndo(): boolean;
    /** Whether redo() would reapply an entry. @since next */
    canRedo(): boolean;
    /** The label undo() would apply, or null. @since next */
    undoLabel(): string | null;
    /** The label redo() would reapply, or null. @since next */
    redoLabel(): string | null;
    /** Stable immutable status snapshot, suitable for useSyncExternalStore. @since next */
    snapshot(): HistoryStatus;
    /** Subscribe to changes in availability or labels; does not call immediately. @since next */
    subscribe(listener: (status: HistoryStatus) => void): () => void;
    /** Clear entries and invalidate unfinished History recordings. Never persists History. @since next */
    clear(): void;
    /** Stage synchronous writes, publishing all values on success as one entry. Nested calls share the outer buffer. @since next */
    transaction<T>(
      label: string,
      callback: () => T & (T extends PromiseLike<unknown> ? never : unknown),
    ): T;
  }
  /** The same manager used by native code; survives editor recreation. @since next */
  export const stateHistory: StateHistory;
}

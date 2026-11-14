/** Config-defined factory presets, shared by the plugin UI and native processor. */
declare module 'soundor:presets' {
  export interface FactoryPresetInfo {
    readonly id: string;
    readonly name: string;
  }
  export interface PresetSelection {
    /** Selected factory identity, or null for custom/restored content with no match. */
    readonly factoryId: string | null;
    /** Whether preset-controlled values differ from the selected factory snapshot. */
    readonly modified: boolean;
  }
  export interface Presets {
    readonly factory: {
      /** Immutable catalog in host program order. */
      list(): readonly FactoryPresetInfo[];
      /** Synchronously apply one complete snapshot; recording is opt-in. Throws for an unknown id. */
      load(
        id: string,
        options?: import('soundor:history').HistoryOptions,
      ): void;
    };
    /** Stable immutable snapshot, suitable for useSyncExternalStore. */
    getSnapshot(): PresetSelection;
    /** Subscribe to selection/modified changes; does not call immediately. */
    subscribe(listener: () => void): () => void;
  }
  export const presets: Presets;
}

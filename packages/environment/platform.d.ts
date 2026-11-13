// soundor:host (the host's state and this plugin's identity), soundor:storage
// and soundor:fs (data private to the plugin).

declare module 'soundor:host' {
  /** The runtime and native binary's environment; browser detection is best effort. */
  export interface HostEnvironment {
    readonly runtime: string;
    readonly runtimeVersion: string;
    readonly platform:
      | 'macos'
      | 'windows'
      | 'linux'
      | 'ios'
      | 'android'
      | 'unknown';
    readonly arch: 'arm64' | 'x64' | 'unknown';
    readonly format: 'vst3' | 'au' | 'standalone' | 'web' | 'unknown';
  }

  export interface Timecode {
    readonly framesPerSecond: number;
    readonly dropFrame: boolean;
    /** Offset in units of 1/80 of a frame, when reported. */
    readonly smpteOffsetSubframes?: number;
  }

  export interface TrackInfo {
    readonly name?: string;
    /** CSS hexadecimal RGBA: #rrggbbaa. */
    readonly color?: string;
    /** One-based index within the host's channel namespace, when reported. */
    readonly index?: number;
    /** Host-provided identifier; stability depends on the host. */
    readonly id?: string;
  }

  export interface Transport {
    readonly playing: boolean;
    readonly recording: boolean;
    readonly looping: boolean;
    readonly bpm: number;
    readonly timeSignature: {
      readonly numerator: number;
      readonly denominator: number;
    };
    /** Musical position in quarter notes, and where its bar starts. */
    readonly ppqPosition: number;
    readonly barStartPpq: number;
    readonly timeInSeconds: number;
    readonly timeInSamples: number;
    /** Loop boundaries in quarter notes, when reported. */
    readonly loopStartPpq?: number;
    readonly loopEndPpq?: number;
    readonly timecode?: Timecode;
  }

  export interface HostSnapshot {
    readonly sampleRate: number;
    /** The configured maximum block size; individual processing blocks may be smaller. */
    readonly blockSize: number;
    /** The host's name, when the runtime can identify it. */
    readonly hostName: string;
    readonly hostVersion?: string;
    readonly samplePrecision: 'float32' | 'float64' | 'unknown';
    readonly processingMode: 'realtime' | 'prefetch' | 'offline' | 'unknown';
    readonly track?: TrackInfo;
    /** null until the host reports a transport. */
    readonly transport: Transport | null;
  }

  /** Configured plugin identity. Version defaults to 0.1.0. */
  export const plugin: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
  };
  /** Constant for this editor's lifetime. */
  export const environment: Readonly<HostEnvironment>;
  /** The current immutable host state; the same object until it changes. */
  export function getHostState(): HostSnapshot;
  /** Calls listener on changes, without an initial call. Returns an unsubscribe function. */
  export function subscribeHostState(
    listener: (state: HostSnapshot) => void,
  ): () => void;
}

declare module 'soundor:storage' {
  /** Persistent key/value storage private to this plugin. Values are JSON data. */
  export const storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    keys(): Promise<string[]>;
    clear(): Promise<void>;
  };
}

declare module 'soundor:fs' {
  /**
   * File access confined to this plugin's data directory. Paths are relative
   * and '/'-separated ('presets/warm.json'); they cannot leave the directory.
   */
  export interface DirectoryEntry {
    readonly name: string;
    readonly kind: 'file' | 'directory';
  }

  export interface FileStat {
    readonly kind: 'file' | 'directory';
    readonly size: number;
    /** Last modification, in milliseconds since the Unix epoch. */
    readonly modified: number;
  }

  export function readBytes(path: string): Promise<Uint8Array>;
  export function readText(path: string): Promise<string>;
  /** Replaces the file atomically, creating missing parent directories. */
  export function writeBytes(
    path: string,
    data: ArrayBuffer | ArrayBufferView,
  ): Promise<void>;
  export function writeText(path: string, text: string): Promise<void>;
  export function readDir(path?: string): Promise<DirectoryEntry[]>;
  export function mkdir(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<void>;
  export function remove(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<void>;
  export function stat(path: string): Promise<FileStat | null>;
  export function exists(path: string): Promise<boolean>;
}

import type { StateSchema } from '@soundor/core/state';
/** Who may change a parameter: the UI and automation, the UI only, or the processing only. */
export type ParameterAccess = 'automatable' | 'manual' | 'readOnly';

/** A parameter's metadata, as `soundor:parameters` reports it in `info`. */
export type ParameterInfo =
  | {
      readonly id: string;
      readonly label: string;
      readonly access: ParameterAccess;
      readonly type:
        | 'int8'
        | 'uint8'
        | 'int16'
        | 'uint16'
        | 'int32'
        | 'uint32'
        | 'float32';
      readonly min: number;
      readonly max: number;
      readonly default: number;
      readonly step?: number;
      readonly unit?: string;
    }
  | {
      readonly id: string;
      readonly label: string;
      readonly access: ParameterAccess;
      readonly type: 'boolean';
      readonly default: boolean;
    }
  | {
      readonly id: string;
      readonly label: string;
      readonly access: ParameterAccess;
      readonly type: 'choice';
      readonly options: readonly {
        readonly value: string;
        readonly label: string;
      }[];
      readonly default: string;
    };

/**
 * A parameter's behavior as `@soundor/config` resolves it: expression trees
 * (JSON) over plain numbers of `valueType`, which the runtime compiles.
 */
export interface ParameterSemanticsInit {
  readonly valueType: string;
  readonly toValue: unknown;
  readonly toNormalized: unknown;
  readonly constrain: unknown;
  readonly format: unknown;
  readonly parse: unknown;
}

/** A resolved parameter (`@soundor/config`'s `ResolvedParameter`), as JSON. */
export type ParameterInit = ParameterInfo & {
  readonly semantics: ParameterSemanticsInit;
  readonly mapping?: unknown;
};

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

/** A rectangle in the view's logical pixels. */
export interface ViewRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
/**
 * The simulated view's size: logical pixels, device pixels per one, and the
 * part of it always shown (the whole view unless a test says otherwise).
 */
export interface ViewSize {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly safeArea: ViewRect;
}
/** What a test sets of the view: a safe area of null is the whole view. */
export interface ViewSizeInit {
  readonly width?: number;
  readonly height?: number;
  readonly scale?: number;
  readonly safeArea?: ViewRect | null;
}
/**
 * The simulated editor's size, in its whole logical pixels, and whether
 * requestEditorSize() can ask for another.
 */
export interface EditorSize {
  readonly width: number;
  readonly height: number;
  readonly resizable: boolean;
}
/**
 * The simulated editor: its size, and how it takes requestEditorSize(). A
 * project's soundor.config sets the size, resizability and limits.
 */
export interface EditorInit {
  /** By default the view's (an editor that lays out again, shown). */
  width?: number;
  height?: number;
  /** Whether requestEditorSize() can ask for another size: false by default. */
  resizable?: boolean;
  /** The limits requests are held to: 1 to Infinity by default. */
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  /**
   * The configured size of an editor that scales keeping its aspect ratio:
   * requests keep its shape. Null (the default): each side on its own.
   */
  aspectRatio?: { readonly width: number; readonly height: number } | null;
  /**
   * Whether the simulated host gives the editor the sizes asked for (after
   * the calling code, in a microtask), or, false, ignores them as a host may.
   * True by default.
   */
  applyRequests?: boolean;
}
export interface RuntimeOptions {
  /** Explicit custom values; built-ins use development mode in tests. */
  env?: Readonly<Record<string, string | boolean | number>>;
  /** Persistent schema, supplied by the Vitest plugin. */
  state?: StateSchema;
  plugin?: { id: string; name: string; version?: string };
  environment?: Partial<HostEnvironment>;
  /** Resolved parameters (`resolveConfig(...).parameters`), as the Vitest plugin passes them. */
  parameters?: readonly ParameterInit[];
  host?: Partial<HostSnapshot>;
  /**
   * The view's size; by default the project's editor size (800×600 without
   * one) at a scale of 1, all of it safe. Nothing is laid out at it: it is
   * what viewSize() reports.
   */
  view?: ViewSizeInit;
  /**
   * The editor, whose size editorSize() reports; by default the view's (an
   * editor that lays out again, shown), fixed. Independent of the view: set
   * both to simulate an editor that scales.
   */
  editor?: EditorInit;
  /** Declared methods in the simulated project; omitted for direct runtime unit tests. */
  nativeMethods?: readonly string[];
  /** Declared native events in the simulated project; omitted for direct runtime unit tests. */
  nativeEvents?: readonly string[];
  /** Declared native channels in the simulated project; omitted for direct runtime unit tests. */
  nativeChannels?: readonly string[];
  native?: Record<string, (...args: never[]) => unknown>;
}
/** JSON serialization matches storage; returned objects are independent copies. */
export class MemoryStorage {
  private values = new Map<string, string>();
  constructor(private active: () => void) {}
  private key(key: string) {
    this.active();
    if (typeof key !== 'string')
      throw new TypeError('Storage keys must be strings');
    return key;
  }
  async get<T = unknown>(key: string): Promise<T | undefined> {
    const text = this.values.get(this.key(key));
    return text === undefined ? undefined : (JSON.parse(text) as T);
  }
  async set(key: string, value: unknown): Promise<void> {
    const id = this.key(key),
      text = JSON.stringify(value);
    if (text === undefined)
      throw new TypeError('soundor:storage requires JSON data');
    this.values.set(id, text);
  }
  async delete(key: string): Promise<void> {
    this.values.delete(this.key(key));
  }
  async keys(): Promise<string[]> {
    this.active();
    return [...this.values.keys()].sort();
  }
  async clear(): Promise<void> {
    this.active();
    this.values.clear();
  }
  dispose() {
    this.values.clear();
  }
}

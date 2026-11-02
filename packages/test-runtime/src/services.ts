export type ParameterInfo =
  | {
      readonly id: string;
      readonly label: string;
      readonly type: 'float' | 'int';
      readonly min: number;
      readonly max: number;
      readonly default: number;
      readonly unit?: string;
    }
  | {
      readonly id: string;
      readonly label: string;
      readonly type: 'bool';
      readonly default: boolean;
    }
  | {
      readonly id: string;
      readonly label: string;
      readonly type: 'enum';
      readonly values: readonly string[];
      readonly default: string;
    };

export interface HostSnapshot {
  readonly sampleRate: number;
  readonly blockSize: number;
  readonly hostName: string;
  readonly transport: {
    readonly playing: boolean;
    readonly recording: boolean;
    readonly looping: boolean;
    readonly bpm: number;
    readonly timeSignature: {
      readonly numerator: number;
      readonly denominator: number;
    };
    readonly ppqPosition: number;
    readonly barStartPpq: number;
    readonly timeInSeconds: number;
    readonly timeInSamples: number;
  } | null;
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
/** The simulated editor's size, in its whole logical pixels. */
export interface EditorSize {
  readonly width: number;
  readonly height: number;
}
export interface RuntimeOptions {
  plugin?: { id: string; name: string };
  parameters?: readonly ParameterInfo[];
  host?: Partial<HostSnapshot>;
  /**
   * The view's size; by default the project's editor size (800×600 without
   * one) at a scale of 1, all of it safe. Nothing is laid out at it: it is
   * what viewSize() reports.
   */
  view?: ViewSizeInit;
  /**
   * The editor's size, which editorSize() reports; by default the view's
   * (an editor that lays out again, shown). Independent of the view: set
   * both to simulate an editor that scales.
   */
  editor?: Partial<EditorSize>;
  /** Declared methods in the simulated project; omitted for direct runtime unit tests. */
  nativeMethods?: readonly string[];
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

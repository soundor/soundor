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
export interface RuntimeOptions {
  plugin?: { id: string; name: string };
  parameters?: readonly ParameterInfo[];
  host?: Partial<HostSnapshot>;
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

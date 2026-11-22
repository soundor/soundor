// What the UI's JavaScript runtime must do, checked inside it: the
// language as the engine runs it (Hermes natively, after Soundor lowers the
// bundle) and the Web globals Soundor provides. Each throws when it fails;
// the UI shows which did, and e2e/javascript.test.ts expects none.

export interface Check {
  readonly name: string;
  run(): void | Promise<void>;
}

function expect(condition: boolean, what: string): void {
  if (!condition) throw new Error(what);
}

const later = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

class Counter {
  #count = 0;
  static readonly step = 2;
  next(): number {
    this.#count += Counter.step;
    return this.#count;
  }
}

async function* countdown(from: number) {
  for (let value = from; value > 0; value -= 1) {
    await later(0);
    yield value;
  }
}

export const checks: readonly Check[] = [
  {
    name: 'language',
    run() {
      expect([1, 2, 3].at(-1) === 3, 'Array.prototype.at');
      expect([1, 2, 3].findLast((n) => n < 3) === 2, 'findLast');
      expect([3, 1, 2].toSorted().join() === '1,2,3', 'toSorted');
      expect(Object.hasOwn({ a: 1 }, 'a'), 'Object.hasOwn');
      expect('a-b-c'.replaceAll('-', '') === 'abc', 'replaceAll');
      const match = /(?<year>\d{4})-(?<month>\d{2})/.exec('2026-11');
      expect(match?.groups?.['month'] === '11', 'named groups');
      expect(2n ** 64n === 18446744073709551616n, 'BigInt');
      const counter = new Counter();
      counter.next();
      expect(counter.next() === 4, 'private fields');
      const { a, ...rest } = { a: 1, b: 2, c: 3 };
      expect(a === 1 && Object.keys(rest).join() === 'b,c', 'rest');
      expect((({} as { x?: { y?: number } }).x?.y ?? 7) === 7, 'optional');
    },
  },
  {
    name: 'async',
    async run() {
      const values: number[] = [];
      for await (const value of countdown(3)) values.push(value);
      expect(values.join() === '3,2,1', 'for await');
      const settled = await Promise.allSettled([
        Promise.resolve(1),
        Promise.reject(new Error('no')),
      ]);
      expect(settled[1]?.status === 'rejected', 'allSettled');
    },
  },
  {
    name: 'timers',
    async run() {
      const order: string[] = [];
      setTimeout(() => order.push('timeout 20'), 20);
      setTimeout(() => order.push('timeout 0'), 0);
      queueMicrotask(() => order.push('microtask'));
      void Promise.resolve().then(() => order.push('promise'));
      const cleared = setTimeout(() => order.push('cleared'), 5);
      clearTimeout(cleared);
      order.push('sync');
      await later(60);
      expect(
        order.join() === 'sync,microtask,promise,timeout 0,timeout 20',
        `order ${order.join()}`,
      );
      let ticks = 0;
      await new Promise<void>((resolve) => {
        const id = setInterval(() => {
          ticks += 1;
          if (ticks === 3) {
            clearInterval(id);
            resolve();
          }
        }, 5);
      });
      expect(ticks === 3, 'setInterval');
    },
  },
  {
    name: 'animation frames',
    async run() {
      const first = await new Promise<number>(requestAnimationFrame);
      const second = await new Promise<number>(requestAnimationFrame);
      expect(second > first, `frame times ${first}, ${second}`);
    },
  },
  {
    name: 'performance',
    async run() {
      const start = performance.now();
      await later(15);
      expect(performance.now() - start >= 10, 'performance.now');
    },
  },
  {
    name: 'encoding',
    run() {
      const text = 'Soundor ÄÖÜ ✓ 🎛';
      const bytes = new TextEncoder().encode(text);
      expect(bytes.length === 23, `${bytes.length} UTF-8 bytes`);
      expect(new TextDecoder().decode(bytes) === text, 'TextDecoder');
      expect(atob(btoa('soundor')) === 'soundor', 'base64');
    },
  },
  {
    name: 'URL',
    run() {
      const url = new URL('../b?x=1&y=two#h', 'https://soundor.dev/a/c');
      expect(url.href === 'https://soundor.dev/b?x=1&y=two#h', url.href);
      url.searchParams.append('z', 'a b');
      expect(url.search === '?x=1&y=two&z=a+b', url.search);
    },
  },
  {
    name: 'crypto',
    run() {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      expect(
        bytes.some((byte) => byte !== 0),
        'getRandomValues',
      );
      expect(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          crypto.randomUUID(),
        ),
        'randomUUID',
      );
    },
  },
  {
    name: 'structuredClone',
    run() {
      const original = { when: new Date(0), map: new Map([[1, { a: [1] }]]) };
      const copy = structuredClone(original);
      expect(copy !== original && copy.when instanceof Date, 'Date');
      expect(copy.map.get(1)?.a[0] === 1, 'Map');
      expect(copy.map.get(1) !== original.map.get(1), 'deep');
    },
  },
  {
    name: 'events',
    run() {
      const controller = new AbortController();
      let reason: unknown;
      controller.signal.addEventListener('abort', () => {
        reason = controller.signal.reason;
      });
      controller.abort('stop');
      expect(reason === 'stop', 'AbortSignal');
      const target = new EventTarget();
      let detail: unknown;
      target.addEventListener('ping', (event) => {
        detail = (event as CustomEvent<number>).detail;
      });
      target.dispatchEvent(new CustomEvent('ping', { detail: 42 }));
      expect(detail === 42, 'CustomEvent');
    },
  },
];

/** Runs every check, and names those that failed with why. */
export async function runChecks(): Promise<string[]> {
  const failures: string[] = [];
  for (const check of checks) {
    try {
      await check.run();
    } catch (error) {
      failures.push(
        `${check.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return failures;
}

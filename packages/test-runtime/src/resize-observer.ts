import { TestNode } from './node';

type Box = 'content-box' | 'border-box' | 'device-pixel-content-box';
const BOXES: readonly string[] = [
  'content-box',
  'border-box',
  'device-pixel-content-box',
];

/**
 * ResizeObserver in the simulated runtime: it observes nodes, and checks what
 * it is given, as the runtimes' does. Nothing is laid out here, so every node
 * stays 0×0, and, as for a browser's node that is never laid out, nothing is
 * ever told. To test what a component does with sizes, stub the global with
 * one that calls back.
 */
export class TestResizeObserver {
  readonly #observed = new Map<TestNode, Box>();

  constructor(
    callback: (entries: never[], observer: TestResizeObserver) => void,
  ) {
    if (typeof callback !== 'function') {
      throw new TypeError(
        "Failed to construct 'ResizeObserver': parameter 1 is not a function",
      );
    }
  }

  observe(target: unknown, options: { box?: Box } = {}): void {
    if (!(target instanceof TestNode)) {
      throw new TypeError(
        "Failed to execute 'observe' on 'ResizeObserver': parameter 1 is not a UiNode",
      );
    }
    const box = options?.box ?? 'content-box';
    if (!BOXES.includes(box)) {
      throw new TypeError(
        `Failed to execute 'observe' on 'ResizeObserver': '${String(box)}' is not a valid box`,
      );
    }
    this.#observed.set(target, box);
  }

  unobserve(target: unknown): void {
    if (!(target instanceof TestNode)) {
      throw new TypeError(
        "Failed to execute 'unobserve' on 'ResizeObserver': parameter 1 is not a UiNode",
      );
    }
    this.#observed.delete(target);
  }

  disconnect(): void {
    this.#observed.clear();
  }

  /** The nodes it observes, for a test to check: node → box. */
  get observed(): ReadonlyMap<TestNode, Box> {
    return this.#observed;
  }
}

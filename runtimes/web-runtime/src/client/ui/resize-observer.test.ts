// @vitest-environment happy-dom
// ResizeObserver over nodes. happy-dom has no layout, nor a ResizeObserver
// that tells anything: a stand-in for the browser's records what is observed,
// and a test wakes it as the browser would.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UiNode } from './node';
import { createResizeObserver } from './resize-observer';
import { UiView } from './view';

let view: UiView;
afterEach(() => view?.dispose());

/** The browser's ResizeObserver, as far as this needs it. */
class FakeNative {
  static all: FakeNative[] = [];
  readonly observed = new Map<Element, string | undefined>();
  readonly log: string[] = [];

  constructor(
    readonly callback: (
      entries: { target: Element }[],
      observer: unknown,
    ) => void,
  ) {
    FakeNative.all.push(this);
  }

  observe(target: Element, options?: { box?: string }) {
    this.observed.set(target, options?.box);
    this.log.push('observe');
  }

  unobserve(target: Element) {
    this.observed.delete(target);
    this.log.push('unobserve');
  }

  disconnect() {
    this.observed.clear();
  }

  /** What the browser does in its frame: tells of these elements. */
  wake(...targets: Element[]) {
    this.callback(
      targets.map((target) => ({ target })),
      this,
    );
  }
}

function setup() {
  FakeNative.all = [];
  view = new UiView(document);
  view.mount(document.body);
  const ResizeObserver = createResizeObserver(
    FakeNative as unknown as typeof globalThis.ResizeObserver,
  );
  const box = view.createNode('view');
  box.style = {
    position: 'absolute',
    width: 100,
    height: 40,
    padding: 10,
    borderWidth: 2,
  };
  view.root.appendChild(box);
  return { ResizeObserver, box, element: UiNode.elementOf(box) as Element };
}

const describeEntry = (entry: {
  contentRect: { x: number; y: number; width: number; height: number };
  borderBoxSize: readonly { inlineSize: number; blockSize: number }[];
  contentBoxSize: readonly { inlineSize: number; blockSize: number }[];
  devicePixelContentBoxSize: readonly {
    inlineSize: number;
    blockSize: number;
  }[];
}) =>
  [
    `${entry.contentRect.x},${entry.contentRect.y} ${entry.contentRect.width}x${entry.contentRect.height}`,
    `${entry.contentBoxSize[0]!.inlineSize}x${entry.contentBoxSize[0]!.blockSize}`,
    `${entry.borderBoxSize[0]!.inlineSize}x${entry.borderBoxSize[0]!.blockSize}`,
    `${entry.devicePixelContentBoxSize[0]!.inlineSize}x${entry.devicePixelContentBoxSize[0]!.blockSize}`,
  ].join(' ');

describe('ResizeObserver over nodes', () => {
  it("tells the node's boxes, from Yoga, when the browser wakes it", () => {
    const { ResizeObserver, box, element } = setup();
    const told =
      vi.fn<
        ConstructorParameters<ReturnType<typeof createResizeObserver>>[0]
      >();
    const observer = new ResizeObserver(told);
    observer.observe(box);
    const [native] = FakeNative.all;
    // The element's border box is the node's: that is what wakes it.
    expect(native!.observed.get(element)).toBe('border-box');

    native!.wake(element);
    expect(told).toHaveBeenCalledOnce();
    const [entries, which] = told.mock.calls[0]!;
    expect(which).toBe(observer);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.target).toBe(box);
    expect(describeEntry(entries[0]!)).toBe('12,12 76x16 76x16 100x40 76x16');

    // Woken with nothing changed: nothing to tell.
    native!.wake(element);
    expect(told).toHaveBeenCalledOnce();
    box.style.width = 120;
    view.flushLayout();
    native!.wake(element);
    expect(told).toHaveBeenCalledTimes(2);
    expect(describeEntry(told.mock.calls[1]![0][0]!)).toBe(
      '12,12 96x16 96x16 120x40 96x16',
    );
  });

  it('observes the element again when only the content box changed', () => {
    const { ResizeObserver, box, element } = setup();
    const told =
      vi.fn<
        ConstructorParameters<ReturnType<typeof createResizeObserver>>[0]
      >();
    new ResizeObserver(told).observe(box);
    const [native] = FakeNative.all;
    native!.wake(element);
    native!.log.length = 0;

    // The border box stays 100×40: the browser would not see it.
    box.style.padding = 5;
    view.flushLayout();
    expect(native!.log).toEqual(['unobserve', 'observe']);
    native!.wake(element);
    expect(describeEntry(told.mock.calls[1]![0][0]!)).toBe(
      '7,7 86x26 86x26 100x40 86x26',
    );

    // Nor is a layout that changed nothing observed again.
    native!.log.length = 0;
    box.style.backgroundColor = 'red';
    view.flushLayout();
    expect(native!.log).toEqual([]);
  });

  it('a border-box observer is not told of padding; a node out of the view is 0×0', () => {
    const { ResizeObserver, box, element } = setup();
    const told =
      vi.fn<
        ConstructorParameters<ReturnType<typeof createResizeObserver>>[0]
      >();
    new ResizeObserver(told).observe(box, { box: 'border-box' });
    const [native] = FakeNative.all;
    native!.wake(element);
    box.style.padding = 5;
    view.flushLayout();
    native!.wake(element);
    expect(told).toHaveBeenCalledOnce();

    box.remove();
    native!.wake(element);
    expect(told).toHaveBeenCalledTimes(2);
    expect(describeEntry(told.mock.calls[1]![0][0]!)).toBe(
      '0,0 0x0 0x0 0x0 0x0',
    );
  });

  it('unobserve and disconnect let the element go; DOM elements go to the browser', () => {
    const { ResizeObserver, box, element } = setup();
    const told =
      vi.fn<
        ConstructorParameters<ReturnType<typeof createResizeObserver>>[0]
      >();
    const observer = new ResizeObserver(told);
    observer.observe(box);
    observer.observe(box); // again, the same box: one observation
    const dom = document.createElement('div');
    observer.observe(dom, { box: 'content-box' });
    const [nodes, elements] = FakeNative.all;
    expect([...nodes!.observed.keys()]).toEqual([element]);
    expect([...elements!.observed.keys()]).toEqual([dom]);
    // A DOM element's entries are the browser's, as they are.
    elements!.wake(dom);
    expect(told.mock.calls[0]![0]).toEqual([{ target: dom }]);

    observer.unobserve(box);
    expect(nodes!.observed.size).toBe(0);
    observer.observe(box);
    observer.disconnect();
    expect(nodes!.observed.size).toBe(0);
    expect(elements!.observed.size).toBe(0);
    // Nothing is listening to layouts any more.
    nodes!.log.length = 0;
    box.style.padding = 3;
    view.flushLayout();
    expect(nodes!.log).toEqual([]);
  });

  it('checks its arguments', () => {
    const { ResizeObserver, box } = setup();
    expect(() => new ResizeObserver(1 as never)).toThrow(TypeError);
    expect(() =>
      new ResizeObserver(() => {}).observe(box, {
        box: 'padding-box' as never,
      }),
    ).toThrow('not a valid box');
  });
});

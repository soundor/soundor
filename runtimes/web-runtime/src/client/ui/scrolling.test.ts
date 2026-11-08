// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SMOOTH_SCROLL_MS, UiNode } from './node';
import { UiView } from './view';

let view: UiView;
afterEach(() => {
  view?.dispose();
  vi.restoreAllMocks();
});

function setup() {
  view = new UiView(document);
  view.mount(document.body);
  return view;
}

const el = (node: UiNode) => UiNode.elementOf(node);

/** Frames run by hand, at a clock set by hand. */
function frames() {
  let time = 0;
  let callbacks = new Map<number, FrameRequestCallback>();
  let next = 1;
  vi.spyOn(window.performance, 'now').mockImplementation(() => time);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callbacks.set(next, callback);
    return next++;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle) => {
    callbacks.delete(handle);
  });
  return {
    /** Moves the clock to `at` and runs the frame's callbacks. */
    run(at: number) {
      time = at;
      const due = callbacks;
      callbacks = new Map();
      for (const callback of due.values()) callback(time);
    },
  };
}

/** A 50 by 50 view of `style` holding a box `width` by `height`. */
function list(
  root: UiNode,
  style: Record<string, unknown>,
  width = 50,
  height = 400,
) {
  const node = view.createNode('view');
  node.style = { width: 50, height: 50, ...style };
  const child = view.createNode('view');
  child.style = { width, height, flexShrink: 0 };
  node.appendChild(child);
  root.appendChild(node);
  return node;
}

describe('scrolling from the style', () => {
  it('scrolls a view while its style says, and only along those axes', () => {
    const { root } = setup();
    const node = list(root, { overflowY: 'scroll' }, 300);
    expect(el(node).classList.contains('sd-scroll')).toBe(true);
    expect(el(node).querySelector('.sd-scroll-extent')).not.toBeNull();
    node.scrollTo({ left: 50, top: 30 });
    expect([node.scrollLeft, node.scrollTop]).toEqual([0, 30]);
    // The axis over the shorthand, whatever the order.
    node.style = {
      overflowX: 'hidden',
      overflow: 'scroll',
      width: 50,
      height: 50,
    };
    node.scrollTo({ left: 50 });
    expect(node.scrollLeft).toBe(0);
  });

  it('stops: back to its start, told on the next frame, and nothing left of it', () => {
    const frame = frames();
    const { root } = setup();
    const node = list(root, { overflow: 'scroll' });
    const told: number[] = [];
    node.addEventListener('scroll', () => told.push(node.scrollTop));
    node.scrollTop = 40;
    el(node).dispatchEvent(new Event('scroll'));
    expect(told).toEqual([40]);
    node.style = { overflow: 'hidden', width: 50, height: 50 };
    expect(node.scrollTop).toBe(0);
    expect(el(node).classList.contains('sd-scroll')).toBe(false);
    expect(el(node).querySelector('.sd-scroll-extent')).toBeNull();
    expect(el(node).querySelector('.sd-scroll-indicator')).toBeNull();
    frame.run(16);
    expect(told).toEqual([40, 0]);
    // Code that scrolls it now finds nothing to move, and no error.
    node.scrollTo(0, 20);
    expect(node.scrollTop).toBe(0);
    // And it scrolls again from there.
    node.style = { overflow: 'scroll', width: 50, height: 50 };
    node.scrollTop = 10;
    expect(node.scrollTop).toBe(10);
  });
});

describe('smooth scrolling', () => {
  it('moves frame by frame, eased, as natively, and is told each step', () => {
    const frame = frames();
    const { root } = setup();
    const node = list(root, { overflow: 'scroll' });
    const told: number[] = [];
    node.addEventListener('scroll', () =>
      told.push(Math.round(node.scrollTop)),
    );
    node.scrollTo({ top: 200, behavior: 'smooth' });
    expect(node.scrollTop).toBe(0);
    frame.run(SMOOTH_SCROLL_MS / 2);
    expect(node.scrollTop).toBeCloseTo(100, 3);
    frame.run(SMOOTH_SCROLL_MS);
    expect(node.scrollTop).toBe(200);
    expect(told).toEqual([100, 200]);
    frame.run(SMOOTH_SCROLL_MS * 2);
    expect(told).toHaveLength(2);
  });

  it('stops where it is for the wheel, a scroll at once, or reduced motion', () => {
    const frame = frames();
    const { root } = setup();
    const node = list(root, { overflow: 'scroll' });
    node.scrollBy({ top: 200, behavior: 'smooth' });
    frame.run(SMOOTH_SCROLL_MS / 2);
    node.scrollTop = 30;
    frame.run(SMOOTH_SCROLL_MS);
    expect(node.scrollTop).toBe(30);
    view.animations.reducedMotion = true;
    node.scrollTo({ top: 10, behavior: 'smooth' });
    expect(node.scrollTop).toBe(10);
  });
});

describe('scrollIntoView', () => {
  it('aligns the node in each view around it that scrolls, innermost first', () => {
    const { root } = setup();
    const scroller = view.createNode('view');
    scroller.style = { overflowY: 'scroll', height: 50, padding: 5 };
    const items = Array.from({ length: 10 }, () => {
      const item = view.createNode('view');
      item.style = { height: 20, flexShrink: 0 };
      scroller.appendChild(item);
      return item;
    });
    root.appendChild(scroller);
    const at = (call: () => void) => {
      call();
      return scroller.scrollTop;
    };
    // The same numbers as the engine's test: 40 showing, 205 to scroll.
    expect(at(() => items[5]!.scrollIntoView())).toBe(100);
    expect(at(() => items[5]!.scrollIntoView(false))).toBe(80);
    expect(at(() => items[5]!.scrollIntoView({ block: 'center' }))).toBe(90);
    expect(at(() => items[5]!.scrollIntoView({ block: 'nearest' }))).toBe(90);
    expect(at(() => items[1]!.scrollIntoView({ block: 'nearest' }))).toBe(20);
    expect(at(() => items[8]!.scrollIntoView({ block: 'nearest' }))).toBe(140);
    expect(at(() => items[9]!.scrollIntoView())).toBe(165);

    const outer = view.createNode('view');
    outer.style = { overflowY: 'scroll', height: 100 };
    const spacer = view.createNode('view');
    spacer.style = { height: 300, flexShrink: 0 };
    outer.appendChild(spacer);
    scroller.remove();
    outer.appendChild(scroller);
    root.appendChild(outer);
    items[9]!.scrollIntoView({ block: 'end' });
    expect(scroller.scrollTop).toBe(160);
    expect(outer.scrollTop).toBe(245);
    expect(() => items[0]!.scrollIntoView({ block: 'top' as never })).toThrow(
      TypeError,
    );
  });
});

describe('indicators', () => {
  it('shows a bar only on an axis the style scrolls', () => {
    const { root } = setup();
    Object.defineProperties(view.rootElement, {
      offsetWidth: { value: 800 },
      offsetHeight: { value: 600 },
    });
    view.measure();
    const node = list(root, { overflowY: 'scroll' }, 300);
    view.flushLayout();
    const bar = (axis: string) =>
      el(node).querySelector(`.sd-scroll-indicator-${axis}`) as HTMLElement;
    expect(bar('y').style.display).not.toBe('none');
    expect(bar('x').style.display).toBe('none');
  });
});

// @vitest-environment happy-dom
// The view's size, as viewSize() and subscribeViewSize() report it. happy-dom
// has no layout: the view's measurements, its ResizeObserver and the pixel
// density media query are stubbed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ViewSize } from './types';
import { UiView } from './view';

let view: UiView;
let resized: (() => void) | undefined;
let observed: Element[];
let disconnected: number;
let densityChanged: (() => void) | undefined;
let queries: string[];

beforeEach(() => {
  observed = [];
  disconnected = 0;
  queries = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe(element: Element) {
        observed.push(element);
      }
      disconnect() {
        disconnected += 1;
      }
    },
  );
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
    queries.push(query);
    return {
      media: query,
      matches: true,
      addEventListener: (
        _type: string,
        listener: () => void,
        options?: AddEventListenerOptions,
      ) => {
        densityChanged = listener;
        options?.signal?.addEventListener('abort', () => {
          densityChanged = undefined;
        });
      },
      removeEventListener: () => {},
    } as unknown as MediaQueryList;
  });
  Object.defineProperty(window, 'devicePixelRatio', {
    value: 1,
    configurable: true,
  });
  view = new UiView(document);
  view.mount(document.body);
});

afterEach(() => {
  view.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Lays the view out at `width`×`height`, shown at `shown` times its size. */
function layOut(width: number, height: number, shown = 1): void {
  const element = view.rootElement;
  Object.defineProperty(element, 'offsetWidth', {
    value: width,
    configurable: true,
  });
  Object.defineProperty(element, 'offsetHeight', {
    value: height,
    configurable: true,
  });
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, width * shown, height * shown),
  );
}

function subscribe(): ViewSize[] {
  const sizes: ViewSize[] = [];
  view.subscribeSize((size) => sizes.push(size));
  return sizes;
}

describe('the view size', () => {
  it('is measured, and the same frozen object until it changes', () => {
    layOut(800, 600);
    const size = view.size();
    expect(size).toEqual({ width: 800, height: 600, scale: 1 });
    expect(Object.isFrozen(size)).toBe(true);
    expect(view.size()).toBe(size);
    layOut(800, 601);
    expect(view.size()).not.toBe(size);
    expect(view.size()).toEqual({ width: 800, height: 601, scale: 1 });
  });

  it('is 0×0 before the view is laid out', () => {
    expect(view.size()).toEqual({ width: 0, height: 0, scale: 1 });
  });

  it("tells subscribers when the view's own observer sees a resize", () => {
    // The observer that already refreshes hover: one, on the view's element.
    expect(observed).toEqual([view.rootElement]);
    const a = subscribe();
    const b = subscribe();
    const frame = vi.spyOn(window, 'requestAnimationFrame');
    layOut(1000, 640);
    resized!();
    expect(a).toEqual([{ width: 1000, height: 640, scale: 1 }]);
    expect(b).toEqual(a);
    expect(a[0]).toBe(view.size());
    // Hover is still refreshed after the resize.
    expect(frame).toHaveBeenCalled();

    // An observation without a change tells nobody.
    resized!();
    expect(a).toHaveLength(1);
    layOut(1000, 500);
    resized!();
    expect(a.map((size) => size.height)).toEqual([640, 500]);
  });

  it('tells subscribers of a new pixel density, and keeps watching', () => {
    layOut(800, 600);
    view.measure();
    const sizes = subscribe();
    expect(queries.at(-1)).toBe('(resolution: 1dppx)');
    Object.defineProperty(window, 'devicePixelRatio', {
      value: 2,
      configurable: true,
    });
    densityChanged!();
    expect(sizes).toEqual([{ width: 800, height: 600, scale: 2 }]);
    // A media query matches one density: the next one is watched.
    expect(queries.at(-1)).toBe('(resolution: 2dppx)');
    Object.defineProperty(window, 'devicePixelRatio', {
      value: 1.5,
      configurable: true,
    });
    densityChanged!();
    expect(sizes.map((size) => size.scale)).toEqual([2, 1.5]);
  });

  it('counts the scale the host shows the view at when measured again', () => {
    layOut(800, 600);
    view.measure();
    const sizes = subscribe();
    // The host scaled the view down to half (no observer sees that).
    layOut(800, 600, 0.5);
    view.measure();
    expect(sizes).toEqual([{ width: 800, height: 600, scale: 0.5 }]);
    view.measure();
    expect(sizes).toHaveLength(1);
  });

  it('stops telling a subscriber that unsubscribed', () => {
    const kept = subscribe();
    const gone: ViewSize[] = [];
    const unsubscribe = view.subscribeSize((size) => gone.push(size));
    layOut(500, 400);
    resized!();
    unsubscribe();
    layOut(600, 400);
    resized!();
    expect(gone).toHaveLength(1);
    expect(kept).toHaveLength(2);
  });

  it('tells the other subscribers when one throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    view.subscribeSize(() => {
      throw new Error('listener failed');
    });
    const sizes = subscribe();
    layOut(500, 400);
    resized!();
    expect(sizes).toHaveLength(1);
    expect(error).toHaveBeenCalled();
    expect(() => view.subscribeSize(1 as never)).toThrow(
      'subscribeViewSize() expects a function',
    );
  });

  it('lets go of its observers and subscribers when disposed', () => {
    const sizes = subscribe();
    view.dispose();
    expect(disconnected).toBe(1);
    expect(densityChanged).toBeUndefined();
    layOut(500, 400);
    view.measure();
    expect(sizes).toEqual([]);
  });
});

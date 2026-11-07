import { Canvas, useCanvasSize, type CanvasSize } from '@soundor/react';
import { act, render } from '@soundor/testing-library/react';
import { useLayoutEffect, useRef } from 'react';
import type { UiNode } from 'soundor:ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The simulated runtime lays out nothing, so its ResizeObserver never tells:
 * this one tells what a test says the box is.
 */
let observers: FakeResizeObserver[] = [];

class FakeResizeObserver {
  readonly observed = new Map<UiNode, string | undefined>();

  constructor(
    readonly callback: (entries: unknown[], observer: unknown) => void,
  ) {
    observers.push(this);
  }

  observe(node: UiNode, options?: { box?: string }) {
    this.observed.set(node, options?.box);
  }

  unobserve(node: UiNode) {
    this.observed.delete(node);
  }

  disconnect() {
    this.observed.clear();
  }
}

/** The frame's notices: the canvas's box is `box`, covering `device` pixels. */
function laidOut(box: [number, number], device: [number, number]): void {
  for (const observer of observers)
    for (const target of observer.observed.keys())
      observer.callback(
        [
          {
            target,
            contentBoxSize: [{ inlineSize: box[0], blockSize: box[1] }],
            devicePixelContentBoxSize: [
              { inlineSize: device[0], blockSize: device[1] },
            ],
          },
        ],
        observer,
      );
}

let size: CanvasSize;
let canvas: UiNode;
const drawn: string[] = [];

function Meter() {
  const node = useRef<UiNode>(null);
  const measured = useCanvasSize(node);
  useLayoutEffect(() => {
    size = measured;
    if (measured.width > 0) drawn.push(`${measured.width}x${measured.height}`);
  }, [measured]);
  return (
    <Canvas
      ref={(value) => {
        node.current = value;
        if (value !== null) canvas = value;
      }}
      style={{ flex: 1, height: 80 }}
    />
  );
}

describe('useCanvasSize', () => {
  beforeEach(() => {
    observers = [];
    drawn.length = 0;
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is 0×0 until laid out, observing the device-pixel box', async () => {
    await render(<Meter />);
    expect(size).toEqual({ width: 0, height: 0, scaleX: 1, scaleY: 1 });
    const [observer] = observers;
    expect([...observer!.observed]).toEqual([
      [canvas, 'device-pixel-content-box'],
    ]);
  });

  it('sizes the buffer to the device pixels, and draws in the same callback', async () => {
    await render(<Meter />);
    // 101 logical at 1.25 is 126.25: the box covers 126 device pixels.
    laidOut([101, 80], [126, 100]);
    expect(canvas.width).toBe(126);
    expect(canvas.height).toBe(100);
    expect(size.width).toBe(126);
    expect(size.scaleX).toBeCloseTo(126 / 101);
    expect(size.scaleY).toBe(1.25);
    // Drawn before the callback returned: the frame never shows it blank.
    expect(drawn).toEqual(['126x100']);
    // The same again: nothing renders, nothing is cleared.
    laidOut([101, 80], [126, 100]);
    expect(drawn).toEqual(['126x100']);
    laidOut([120, 80], [150, 100]);
    expect(drawn).toEqual(['126x100', '150x100']);
  });

  it('stops observing when it goes', async () => {
    const result = await render(<Meter />);
    const [observer] = observers;
    await act(async () => {
      await result.unmount();
    });
    expect(observer!.observed.size).toBe(0);
  });
});

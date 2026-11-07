import { ScrollView, useScrollbar, View, type Scrollbar } from '@soundor/react';
import { act, advanceTime, render } from '@soundor/testing-library/react';
import { useRef } from 'react';
import { PointerEvent, type UiNode } from 'soundor:ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let bar: Scrollbar;
let scroll: UiNode;

function Bar({ axis }: { axis?: 'vertical' | 'horizontal' }) {
  const node = useRef<UiNode>(null);
  bar = useScrollbar(node, { axis });
  return (
    <View>
      <ScrollView
        ref={(value) => {
          node.current = value;
          if (value !== null) scroll = value;
        }}
        scrollIndicators={false}
      />
      <View {...bar.trackProps}>
        <View {...bar.thumbProps} style={{ backgroundColor: 'red' }} />
      </View>
    </View>
  );
}

/** What the simulated runtime, which lays out nothing, cannot say. */
function laidOut(client: number, content: number, room: number, origin = 0) {
  for (const [name, value] of [
    ['clientHeight', client],
    ['clientWidth', client],
    ['scrollHeight', content],
    ['scrollWidth', content],
  ] as const)
    Object.defineProperty(scroll, name, { value, configurable: true });
  const track = bar.trackProps.ref.current!;
  Object.defineProperty(track, 'clientHeight', {
    value: room,
    configurable: true,
  });
  Object.defineProperty(track, 'clientWidth', {
    value: room,
    configurable: true,
  });
  Object.defineProperty(bar.thumbProps.ref.current, 'layout', {
    value: { x: origin, y: origin, width: 0, height: 0 },
    configurable: true,
  });
}

/**
 * The simulated runtime lays out nothing, so its ResizeObserver never tells:
 * this one does when a test says sizes changed, telling of all it observes.
 */
let observers: FakeResizeObserver[] = [];

class FakeResizeObserver {
  readonly observed = new Set<UiNode>();

  constructor(readonly callback: (entries: unknown[]) => void) {
    observers.push(this);
  }

  observe(node: UiNode) {
    this.observed.add(node);
  }

  unobserve(node: UiNode) {
    this.observed.delete(node);
  }

  disconnect() {
    this.observed.clear();
  }
}

/** A frame: what scrolled is told, then what was resized. */
async function frame() {
  await advanceTime(16);
  await act(async () => {
    for (const observer of observers)
      if (observer.observed.size > 0)
        observer.callback([...observer.observed].map((target) => ({ target })));
  });
}

async function press(
  target: UiNode,
  type: string,
  client: number,
  offset = client,
) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: client,
    clientY: client,
    offsetX: offset,
    offsetY: offset,
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
}

describe('useScrollbar', () => {
  beforeEach(() => {
    observers = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows nothing where nothing is laid out, and turns off the indicators', async () => {
    await render(<Bar />);
    await frame();
    expect(bar.visible).toBe(false);
    expect(scroll.scrollIndicators).toBe(false);
  });

  it('is visible only with something to scroll, and sizes and moves the thumb', async () => {
    await render(<Bar />);
    laidOut(100, 100, 100);
    await frame();
    expect(bar.visible).toBe(false);
    laidOut(100, 400, 100);
    await frame();
    expect(bar.visible).toBe(true);
    const thumb = bar.thumbProps.ref.current!;
    expect(thumb.style.height).toBe(25);
    expect(thumb.style.backgroundColor).toBe('red');
    scroll.scrollTop = 300;
    await frame();
    expect(thumb.style.transform).toEqual([{ translateY: 75 }]);
    // The content grew: its ResizeObserver says so.
    laidOut(100, 10000, 100);
    await frame();
    expect(thumb.style.height).toBe(16);
  });

  it('observes the scroll view, what it scrolls and the track, until it goes', async () => {
    const result = await render(<Bar />);
    const [observer] = observers.filter((o) => o.observed.size > 0);
    expect([...observer!.observed]).toEqual([
      scroll,
      scroll.firstChild,
      bar.trackProps.ref.current,
    ]);
    await result.unmount();
    expect(observer!.observed.size).toBe(0);
  });

  it('moves the thumb on scroll, with nothing resized', async () => {
    await render(<Bar />);
    laidOut(100, 400, 100);
    await frame();
    const thumb = bar.thumbProps.ref.current!;
    scroll.scrollTop = 300;
    // Only the scroll event: no ResizeObserver tells anything.
    await act(async () => {
      await advanceTime(16);
    });
    expect(thumb.style.transform).toEqual([{ translateY: 75 }]);
  });

  it('keeps what it set through a render that sets the style', async () => {
    const result = await render(<Bar />);
    laidOut(100, 400, 100);
    await frame();
    scroll.scrollTop = 300;
    await frame();
    await result.rerender(<Bar />);
    const thumb = bar.thumbProps.ref.current!;
    expect(thumb.style.height).toBe(25);
    expect(thumb.style.transform).toEqual([{ translateY: 75 }]);
  });

  it('follows a drag of the thumb, wherever the pointer goes', async () => {
    await render(<Bar />);
    laidOut(100, 400, 100);
    await frame();
    const thumb = bar.thumbProps.ref.current!;
    const track = bar.trackProps.ref.current!;
    const down = await press(thumb, 'pointerdown', 10);
    expect(down.defaultPrevented).toBe(true);
    expect(bar.pressed).toBe(true);
    // Pressed on the thumb: nothing moved yet. 75 to travel for 300 to scroll.
    expect(scroll.scrollTop).toBe(0);
    await press(track, 'pointermove', 20);
    expect(scroll.scrollTop).toBe(40);
    await press(track, 'pointerup', 20);
    expect(bar.pressed).toBe(false);
    await press(track, 'pointermove', 50);
    expect(scroll.scrollTop).toBe(40);
  });

  it('jumps to a press on the track, and drags from there', async () => {
    await render(<Bar />);
    laidOut(100, 400, 100);
    await frame();
    const track = bar.trackProps.ref.current!;
    await press(track, 'pointerdown', 60);
    // The 25 long thumb's middle at 60: 47.5 of its 75 to travel.
    expect(scroll.scrollTop).toBe(190);
    await press(track, 'pointermove', 70);
    expect(scroll.scrollTop).toBe(230);
  });

  it('counts a press from where the thumb starts, inside the padding', async () => {
    await render(<Bar />);
    laidOut(100, 400, 100, 3);
    await frame();
    await press(bar.trackProps.ref.current!, 'pointerdown', 63);
    expect(scroll.scrollTop).toBe(190);
  });

  it('works across as well', async () => {
    await render(<Bar axis="horizontal" />);
    laidOut(100, 400, 100);
    await frame();
    const track = bar.trackProps.ref.current!;
    expect(bar.thumbProps.ref.current!.style.width).toBe(25);
    await press(track, 'pointerdown', 60);
    expect(scroll.scrollLeft).toBe(190);
    expect(scroll.scrollTop).toBe(0);
  });

  it('says when the pointer is over the track', async () => {
    await render(<Bar />);
    const track = bar.trackProps.ref.current!;
    expect(bar.hovered).toBe(false);
    await press(track, 'pointerenter', 0);
    expect(bar.hovered).toBe(true);
    await press(track, 'pointerleave', 0);
    expect(bar.hovered).toBe(false);
  });
});

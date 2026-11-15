// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScrollIndicators } from './scroll-indicators';

const BOX = {
  contentWidth: 100,
  contentHeight: 400,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  clientWidth: 100,
  clientHeight: 100,
  borderLeft: 0,
  borderTop: 0,
};

function setup(scale = 1, box = BOX) {
  const element = document.createElement('div');
  document.body.append(element);
  Object.defineProperties(element, {
    offsetWidth: { value: 100 },
    offsetHeight: { value: 100 },
    scrollTop: { value: 0, writable: true },
    scrollLeft: { value: 0, writable: true },
  });
  element.getBoundingClientRect = () =>
    ({
      left: 10,
      top: 20,
      right: 10 + 100 * scale,
      bottom: 20 + 100 * scale,
      width: 100 * scale,
      height: 100 * scale,
    }) as DOMRect;
  const indicators = new ScrollIndicators(element);
  indicators.place(box);
  const [vertical, horizontal] = element.querySelectorAll<HTMLElement>(
    '.sd-scroll-indicator',
  );
  const [track, horizontalTrack] =
    element.querySelectorAll<HTMLElement>('.sd-scroll-track');
  return {
    element,
    indicators,
    vertical: vertical!,
    horizontal: horizontal!,
    track: track!,
    horizontalTrack: horizontalTrack!,
  };
}

const pointer = (
  target: EventTarget,
  type: string,
  clientX: number,
  clientY: number,
  init: PointerEventInit = {},
) => {
  const event = new window.PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse',
    clientX,
    clientY,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
};

const grown = (bar: HTMLElement) =>
  bar.classList.contains('sd-scroll-indicator-grown');

describe('scroll indicators', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it('shows the track of the edge a mouse is near, with its bar grown', () => {
    const { element, vertical, horizontal, track } = setup();
    expect(vertical.style.width).toBe('3px');
    expect(vertical.style.left).toBe('95px');
    expect(track.style.display).toBe('none');
    // On the 12 wide strip at the right of a box at (10, 20), not the bottom's.
    pointer(element, 'pointermove', 10 + 88, 20 + 50);
    expect(grown(vertical)).toBe(true);
    expect(grown(horizontal)).toBe(false);
    expect(vertical.style.width).toBe('8px');
    expect(vertical.style.left).toBe('90px');
    expect(track.style.display).toBe('block');
    expect(track.style.left).toBe('88px');
    expect(track.style.width).toBe('12px');
    expect(track.style.height).toBe('100px');
    pointer(element, 'pointermove', 10 + 87, 20 + 50);
    expect(grown(vertical)).toBe(false);
    expect(vertical.style.width).toBe('3px');
    expect(track.style.display).toBe('none');
    pointer(element, 'pointermove', 10 + 89, 20 + 50);
    element.dispatchEvent(new window.PointerEvent('pointerleave'));
    expect(grown(vertical)).toBe(false);
    expect(track.style.display).toBe('none');
  });

  it('uses the border edge for padded tracks and the content box for the scroll range', () => {
    const { element, vertical, horizontal, track, horizontalTrack } = setup(1, {
      ...BOX,
      x: 2,
      y: 2,
      width: 96,
      height: 96,
      clientWidth: 76,
      clientHeight: 76,
      contentWidth: 400,
      borderLeft: 2,
      borderTop: 2,
    });
    const length = (96 * 76) / 400;
    const travel = 96 - length;
    expect(parseFloat(vertical.style.height)).toBeCloseTo(length);
    expect(vertical.style.left).toBe('91px');
    expect(horizontal.style.top).toBe('91px');
    // Hover and drag in the padding strip, outside the content box.
    pointer(element, 'pointermove', 10 + 95, 20 + 10);
    expect(track.style.height).toBe('96px');
    pointer(track, 'pointerdown', 10 + 95, 20 + 10, { button: 0 });
    pointer(track, 'pointermove', 10 + 95, 20 + 10 + travel);
    expect(element.scrollTop).toBeCloseTo(324);
    pointer(track, 'pointerup', 10 + 95, 20 + 10 + travel);
    pointer(element, 'pointermove', 10 + 10, 20 + 95);
    pointer(horizontalTrack, 'pointerdown', 10 + 10, 20 + 95, { button: 0 });
    pointer(horizontalTrack, 'pointermove', 10 + 10 + travel, 20 + 95);
    expect(element.scrollLeft).toBeCloseTo(324);
  });

  it('keeps a track out of the way of an axis that does not scroll', () => {
    const { element, horizontal, horizontalTrack } = setup();
    pointer(element, 'pointermove', 10 + 50, 20 + 95);
    expect(grown(horizontal)).toBe(true);
    expect(horizontalTrack.style.display).toBe('none');
  });

  it('scrolls by a drag of the bar, in proportion, and keeps it from the view', () => {
    const { element, vertical, track } = setup();
    const seen = vi.fn<() => void>();
    element.parentElement!.addEventListener('pointerdown', seen);
    element.parentElement!.addEventListener('pointermove', seen);
    element.parentElement!.addEventListener('pointerup', seen);
    pointer(element, 'pointermove', 105, 30);
    seen.mockClear();
    const down = pointer(track, 'pointerdown', 105, 30, { button: 0 });
    expect(down.defaultPrevented).toBe(true);
    expect(vertical.className).toContain('sd-scroll-indicator-pressed');
    // Pressed on the bar: it stays. A 25 long bar has 75 to travel, for 300 to
    // scroll: 4 for each.
    expect(element.scrollTop).toBe(0);
    pointer(track, 'pointermove', 105, 40);
    expect(element.scrollTop).toBe(40);
    expect(vertical.style.top).toBe(`${(75 * 40) / 300 + 40}px`);
    // Stays grown with the pointer away; once released, it is not.
    pointer(track, 'pointermove', 400, 50);
    expect(element.scrollTop).toBe(80);
    expect(grown(vertical)).toBe(true);
    pointer(track, 'pointerup', 400, 50);
    expect(vertical.className).not.toContain('sd-scroll-indicator-pressed');
    expect(grown(vertical)).toBe(false);
    expect(seen).not.toHaveBeenCalled();
    // After the drag, a move means nothing to the scroll position.
    pointer(track, 'pointermove', 105, 90);
    expect(element.scrollTop).toBe(80);
  });

  it('jumps to a press on the track, and drags from there', () => {
    const { element, vertical, track } = setup();
    pointer(element, 'pointermove', 105, 20 + 60);
    pointer(track, 'pointerdown', 105, 20 + 60, { button: 0 });
    // The middle of the 25 long bar at 60: 47.5 of its 75 to travel.
    expect(element.scrollTop).toBe(190);
    expect(vertical.style.top).toBe(`${47.5 + 190}px`);
    pointer(track, 'pointermove', 105, 20 + 70);
    expect(element.scrollTop).toBe(230);
    pointer(track, 'pointerup', 105, 20 + 70);
    // And back, above where the bar is now.
    pointer(element, 'pointermove', 105, 20 + 5);
    pointer(track, 'pointerdown', 105, 20 + 5, { button: 0 });
    expect(element.scrollTop).toBe(((5 - 12.5) * 300) / 75);
  });

  it('jumps across as well', () => {
    const { element, horizontal, horizontalTrack } = setup(1, {
      ...BOX,
      contentWidth: 400,
      contentHeight: 100,
    });
    pointer(element, 'pointermove', 10 + 60, 20 + 95);
    expect(grown(horizontal)).toBe(true);
    expect(horizontalTrack.style.top).toBe('88px');
    pointer(horizontalTrack, 'pointerdown', 10 + 60, 20 + 95, { button: 0 });
    expect(element.scrollLeft).toBe(190);
    pointer(horizontalTrack, 'pointermove', 10 + 70, 20 + 95);
    expect(element.scrollLeft).toBe(230);
  });

  it('counts the distance on screen under a transformed ancestor', () => {
    const { element, track } = setup(2);
    pointer(track, 'pointerdown', 200, 30, { button: 0 });
    // 20 on screen is 10 laid out.
    pointer(track, 'pointermove', 200, 50);
    expect(element.scrollTop).toBe(40);
    pointer(track, 'pointerup', 200, 50);
    // A press at 120 on screen is at 60 laid out.
    element.scrollTop = 0;
    pointer(track, 'pointerdown', 200, 20 + 120, { button: 0 });
    expect(element.scrollTop).toBe(190);
  });

  it('leaves another button, and touch, to the view', () => {
    const { element, track } = setup();
    const seen = vi.fn<() => void>();
    element.parentElement!.addEventListener('pointerdown', seen);
    pointer(track, 'pointerdown', 105, 80, { button: 2 });
    pointer(track, 'pointerdown', 105, 80, { pointerType: 'touch' });
    expect(seen).toHaveBeenCalledTimes(2);
    expect(element.scrollTop).toBe(0);
    pointer(track, 'pointermove', 105, 90, { pointerType: 'touch' });
    expect(element.scrollTop).toBe(0);
  });

  it('after touch, shows the bars only while scrolling', () => {
    vi.useFakeTimers();
    const { element, vertical, track } = setup();
    expect(vertical.className).not.toContain('sd-scroll-indicator-touch');
    pointer(element, 'pointermove', 105, 30);
    expect(grown(vertical)).toBe(true);
    pointer(element, 'pointerdown', 50, 50, { pointerType: 'touch' });
    expect(grown(vertical)).toBe(false);
    expect(track.style.display).toBe('none');
    expect(vertical.className).toContain('sd-scroll-indicator-touch');
    // A finger's moves do not grow it.
    pointer(element, 'pointermove', 105, 30, { pointerType: 'touch' });
    expect(grown(vertical)).toBe(false);
    element.dispatchEvent(new Event('scroll'));
    expect(vertical.className).toContain('sd-scroll-indicator-showing');
    vi.advanceTimersByTime(900);
    element.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(900);
    expect(vertical.className).toContain('sd-scroll-indicator-showing');
    vi.advanceTimersByTime(100);
    expect(vertical.className).not.toContain('sd-scroll-indicator-showing');
    // A mouse is back: always shown again.
    pointer(element, 'pointermove', 50, 50);
    expect(vertical.className).not.toContain('sd-scroll-indicator-touch');
  });

  it('forgets the pointer when taken away', () => {
    const { element, indicators, vertical, track } = setup();
    pointer(element, 'pointermove', 105, 30);
    pointer(track, 'pointerdown', 105, 30, { button: 0 });
    indicators.release();
    expect(vertical.className).not.toContain('sd-scroll-indicator-pressed');
    expect(grown(vertical)).toBe(false);
    expect(track.style.display).toBe('none');
    pointer(track, 'pointermove', 105, 90);
    expect(element.scrollTop).toBe(0);
  });
});

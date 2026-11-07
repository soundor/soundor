import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { UiNode } from 'soundor:ui';

import { flushSync } from './root';

/** A canvas's drawing buffer, sized to the device pixels its box covers. */
export interface CanvasSize {
  /** The buffer's width in device pixels; 0 until the canvas is laid out. */
  readonly width: number;
  /** The buffer's height in device pixels; 0 until the canvas is laid out. */
  readonly height: number;
  /**
   * Buffer pixels per logical pixel across: `setTransform(scaleX, 0, 0,
   * scaleY, 0, 0)` draws in the box's own units, exactly over it.
   */
  readonly scaleX: number;
  /** Buffer pixels per logical pixel down. */
  readonly scaleY: number;
}

const UNSIZED: CanvasSize = Object.freeze({
  width: 0,
  height: 0,
  scaleX: 1,
  scaleY: 1,
});

/**
 * Keeps a canvas's drawing buffer exactly the device pixels its box covers,
 * at any display scale and whatever sizes the box, and re-renders when that
 * changes. Give the canvas a size by its style or by flexbox, and no `width`
 * or `height`: the hook sets them.
 *
 *   const canvas = useRef<UiNode>(null);
 *   const size = useCanvasSize(canvas);
 *
 *   useLayoutEffect(() => {
 *     const context = canvas.current?.getContext('2d');
 *     if (!context || size.width === 0) return;
 *     context.setTransform(size.scaleX, 0, 0, size.scaleY, 0, 0);
 *     // draw in logical pixels
 *   }, [size]);
 *
 *   <Canvas ref={canvas} style={{ flex: 1, height: 80 }} />
 *
 * Resizing a buffer clears it, so the render it causes comes at once: effects
 * that draw, layout effects especially, run before that frame is drawn.
 */
export function useCanvasSize(canvas: RefObject<UiNode | null>): CanvasSize {
  const [size, setSize] = useState(UNSIZED);
  const watched = useRef<{
    observer: ResizeObserver | null;
    node: UiNode | null;
  }>({ observer: null, node: null });

  // The canvas may come and go with renders: each one checks it is the one
  // observed.
  useLayoutEffect(() => {
    const state = watched.current;
    const node = canvas.current;
    if (node === state.node) return;
    state.observer ??= new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const [device] = entry.devicePixelContentBoxSize;
      const [box] = entry.contentBoxSize;
      if (device === undefined || box === undefined) return;
      const target = entry.target;
      const width = device.inlineSize;
      const height = device.blockSize;
      if (target.width !== width) target.width = width;
      if (target.height !== height) target.height = height;
      const next: CanvasSize = {
        width,
        height,
        scaleX: box.inlineSize > 0 ? width / box.inlineSize : 1,
        scaleY: box.blockSize > 0 ? height / box.blockSize : 1,
      };
      flushSync(() =>
        setSize((previous) =>
          previous.width === next.width &&
          previous.height === next.height &&
          previous.scaleX === next.scaleX &&
          previous.scaleY === next.scaleY
            ? previous
            : next,
        ),
      );
    });
    state.observer.disconnect();
    if (node !== null)
      state.observer.observe(node, { box: 'device-pixel-content-box' });
    state.node = node;
  });
  useEffect(
    () => () => {
      watched.current.observer?.disconnect();
      watched.current.node = null;
    },
    [],
  );
  return size;
}

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { subscribeViewSize, viewSize, type ViewSize } from 'soundor:ui';

/** What useParameter needs of a parameter (soundor:parameters' shape). */
export interface ParameterLike<T> {
  get(): T;
  subscribe(listener: (value: T) => void): () => void;
}

/**
 * A parameter's value, re-rendering when it changes (the host automates
 * it, another view moves it, the UI sets it).
 *
 *   const gain = useParameter(parameters.gain);
 */
export function useParameter<T>(parameter: ParameterLike<T>): T {
  return useSyncExternalStore(
    (onChange) => parameter.subscribe(() => onChange()),
    () => parameter.get(),
  );
}

/** Calls `callback` on every frame while the component is mounted. */
export function useAnimationFrame(callback: (time: number) => void): void {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    let frame = requestAnimationFrame(function tick(time) {
      latest.current(time);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
}

/**
 * The plugin view's size in logical pixels, and its `scale` (device pixels
 * per logical pixel), re-rendering when the user resizes the editor or the
 * view moves to a display of another density; never for an unchanged size.
 * For a layout that changes at a breakpoint; a layout that only grows and
 * shrinks needs flexbox, not this.
 *
 *   const { width } = useViewSize();
 *   const compact = width < 640;
 */
export function useViewSize(): ViewSize {
  return useSyncExternalStore(subscribeViewSize, viewSize);
}

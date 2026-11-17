import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { history, type HistoryStatus } from 'soundor:history';
import {
  getHostState,
  subscribeHostState,
  type HostSnapshot,
} from 'soundor:host';
import type { PresetSelection } from 'soundor:presets';
import {
  editorSize,
  isFocused,
  isVisible,
  subscribeEditorSize,
  subscribeFocus,
  subscribeVisibility,
  subscribeViewSize,
  viewSize,
  type EditorSize,
  type ViewSize,
} from 'soundor:ui';

/** What useParameter needs of a parameter (soundor:parameters' shape). */
export interface ParameterLike<T> {
  get(): T;
  subscribe(listener: (value: T) => void): () => void;
}

/**
 * The value of anything with `get()` and `subscribe()`: what a parameter, a
 * persistent state field and a native stream have in common. The
 * subscription follows the source, not the render: it is made once while the
 * component is mounted, and again only for another source.
 */
function useSubscribedValue<T>(source: ParameterLike<T>): T {
  const subscribe = useCallback(
    (onChange: () => void) => source.subscribe(() => onChange()),
    [source],
  );
  return useSyncExternalStore(subscribe, () => source.get());
}

/**
 * A parameter's value, re-rendering when it changes (the host automates
 * it, another view moves it, the UI sets it).
 *
 *   const gain = useParameter(parameters.gain);
 */
export function useParameter<T>(parameter: ParameterLike<T>): T {
  return useSubscribedValue(parameter);
}

/** A persistent state's value. The store supplies stable immutable snapshots. */
export function useStateValue<T>(field: ParameterLike<T>): T {
  return useSubscribedValue(field);
}

/** What useNativeStream needs of a stream (soundor:native's `NativeStream`). */
export interface NativeStreamLike<T> {
  get(): T | undefined;
  subscribe(listener: (value: T, sequence: number) => void): () => void;
}

/**
 * The latest value of a native stream (`native.streams` in the config),
 * re-rendering when a newer one arrives: at most once a frame, the values
 * published in between skipped. `undefined` until native code has published
 * one. To draw each value as it arrives without rendering again, subscribe
 * in an effect instead.
 *
 *   const peak = useNativeStream(streams.peak);
 */
export function useNativeStream<T>(stream: NativeStreamLike<T>): T | undefined {
  return useSubscribedValue<T | undefined>(stream);
}

/** Calls `callback` on every frame while the component is mounted. */
export function useAnimationFrame(callback: (time: number) => void): void {
  const latest = useRef(callback);
  useLayoutEffect(() => {
    latest.current = callback;
  });
  useEffect(() => {
    let frame = requestAnimationFrame(function tick(time) {
      latest.current(time);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
}

/**
 * The plugin view's size in logical pixels, its `scale` (device pixels per
 * logical pixel) and its `safeArea`, re-rendering when the user resizes the
 * editor or the view moves to a display of another density; never for an
 * unchanged size. For a layout that changes at a breakpoint, or that keeps
 * its content in the safe area of an editor that covers its window (`fit:
 * 'cover'`); a layout that only grows and shrinks needs flexbox, not this.
 *
 *   const { width } = useViewSize();
 *   const compact = width < 640;
 */
export function useViewSize(): ViewSize {
  return useSyncExternalStore(subscribeViewSize, viewSize);
}

/**
 * The editor's actual size in whole logical pixels, and whether it can be
 * asked for another (`resizable`), re-rendering when the user, the DAW or the
 * web page resizes it; never for an unchanged size. Unlike {@link useViewSize}
 * it is the window the view is shown in, which an editor that scales draws
 * the view at a zoom of: for a resize grip that asks for a size with
 * `requestEditorSize()`, not for laying out.
 *
 *   const editor = useEditorSize();
 *   if (!editor.resizable) return null;
 */
export function useEditorSize(): EditorSize {
  return useSyncExternalStore(subscribeEditorSize, editorSize);
}

/**
 * Whether the editor is visible: the page's visibility on the web, whether
 * the editor is showing in a native host. For pausing optional work (a
 * spectrum, an animation) while hidden; it does not pause audio, timers or
 * native streams by itself, and it is not keyboard focus ({@link
 * useEditorFocus}).
 *
 *   const visible = useEditorVisibility();
 *   return visible ? <Spectrum /> : null;
 */
export function useEditorVisibility(): boolean {
  return useSyncExternalStore(subscribeVisibility, isVisible);
}

/**
 * Whether keyboard focus is within the editor, its controls included,
 * re-rendering when it enters or leaves. A shown editor can be unfocused
 * (another window has the focus); focus is independent of visibility and of
 * which control has focus inside the editor.
 *
 *   const focused = useEditorFocus();
 */
export function useEditorFocus(): boolean {
  return useSyncExternalStore(subscribeFocus, isFocused);
}

/**
 * What the host says of itself and its transport (`soundor:host`): sample
 * rate, block size, host name, track and transport. A new snapshot arrives
 * every frame while the transport plays, so a component that needs only
 * part of it (the tempo) re-renders then too; keep it small or draw from
 * `subscribeHostState()` in an effect.
 *
 *   const { transport } = useHostState();
 */
export function useHostState(): HostSnapshot {
  return useSyncExternalStore(subscribeHostState, getHostState);
}

/** What usePresetSelection needs of soundor:presets' `presets`. */
export interface PresetsLike {
  getSnapshot(): PresetSelection;
  subscribe(listener: () => void): () => void;
}

/**
 * Which factory preset is selected (`factoryId`, null for custom content) and
 * whether the preset-controlled values were modified since, re-rendering when
 * either changes. It takes `presets` from `soundor:presets` rather than
 * importing it, so that a plugin that shows no presets does not need the
 * module. The catalog is `presets.factory.list()`, and a preset loads with
 * `presets.factory.load(id)`.
 *
 *   const { factoryId, modified } = usePresetSelection(presets);
 */
export function usePresetSelection(presets: PresetsLike): PresetSelection {
  return useSyncExternalStore(presets.subscribe, presets.getSnapshot);
}

/** Reactive History availability and stable undo/redo actions. Field hooks remain value subscriptions. */
export function useHistory(): HistoryStatus & {
  undo(): void;
  redo(): void;
} {
  const status = useSyncExternalStore(history.subscribe, history.snapshot);
  return useMemo(
    () => ({ ...status, undo: history.undo, redo: history.redo }),
    [status],
  );
}

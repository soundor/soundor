import {
  getTestRuntime,
  type EditorSize,
  type HostSnapshot,
  type ViewSizeInit,
} from '@soundor/test-runtime';

/** Set simulated parameters in plain units using their declared type and range. */
export const testParameters = {
  set(id: string, value: number | boolean | string): void {
    const runtime = getTestRuntime();
    if (!Object.hasOwn(runtime.parameters.byId, id))
      throw new Error(`Unknown Soundor parameter '${id}'`);
    runtime.parameters.byId[id]!.set(value);
  },
};

/** Configure the simulated host snapshot and notify host subscribers. */
export const testHost = {
  set(state: Partial<HostSnapshot>): void {
    getTestRuntime().setHost(state);
  },
};

/**
 * Resize the simulated view, as a user resizing the editor does, and notify
 * viewSize() subscribers (useViewSize()) when it changed. `safeArea` sets
 * the part always shown, as an editor that covers its window with its
 * layout (`fit: 'cover'`) has; null makes it the whole view again.
 */
export const testView = {
  resize(size: ViewSizeInit): void {
    getTestRuntime().setViewSize(size);
  },
};

/**
 * Resize the simulated editor, as a user or a DAW does, and notify
 * editorSize() subscribers when it changed. Only the editor: nothing is laid
 * out here, so resize the view as well (testView.resize) where the runtimes
 * would, as with an editor that lays out again.
 */
export const testEditor = {
  resize(size: Partial<EditorSize>): void {
    getTestRuntime().setEditorSize(size);
  },
};

/** Register a declared simulated native method with an ordinary function or vi.fn(). */
export function mockNative(
  name: string,
  implementation: (...args: never[]) => unknown,
): void {
  getTestRuntime().mockNative(name, implementation);
}

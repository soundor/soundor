import {
  getTestRuntime,
  setParameterAsHost,
  type EditorSize,
  type HostSnapshot,
  type ViewSizeInit,
} from '@soundor/test-runtime';

/**
 * Set simulated parameters in plain units, as the host (automation, a preset)
 * or the plugin's processing does: snapped to their range and step, read-only
 * ones included, and subscribers notified.
 */
export const testParameters = {
  set(id: string, value: number | boolean | string): void {
    const runtime = getTestRuntime();
    if (!Object.hasOwn(runtime.parameters.byId, id))
      throw new Error(`Unknown Soundor parameter '${id}'`);
    setParameterAsHost(runtime.parameters.byId[id]!, value as never);
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
  /**
   * The sizes the UI asked for with requestEditorSize(), held to the
   * editor's limits, in order: what a host was asked, whether it gave them
   * (`editor: { applyRequests: false }` simulates one that does not).
   */
  requests(): readonly { width: number; height: number }[] {
    return getTestRuntime().requestedEditorSizes();
  },
};

/**
 * Publish a declared native event, as the plugin's native code does: the
 * UI's subscribers (`events.<name>` of soundor:native) receive `value`.
 */
export function emitNative(name: string, value?: unknown): void {
  getTestRuntime().emitNativeEvent(name, value);
}

/** Register a declared simulated native method with an ordinary function or vi.fn(). */
export function mockNative(
  name: string,
  implementation: (...args: never[]) => unknown,
): void {
  getTestRuntime().mockNative(name, implementation);
}

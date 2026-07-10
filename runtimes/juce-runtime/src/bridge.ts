/**
 * The browser-side JUCE bridge — the concrete {@link Bridge} a React UI talks to
 * inside a JUCE `WebBrowserComponent`, in place of the in-memory mock.
 *
 * It speaks JUCE's own frontend transport, `window.__JUCE__.backend` (see
 * `modules/juce_gui_extra/native/javascript/check_native_interop.js`): a single
 * named event (`"soundor"`) carrying **structured objects** in both directions —
 * `backend.emitEvent("soundor", obj)` to the C++ editor, and
 * `backend.addEventListener("soundor", obj => …)` for frames it emits back with
 * `emitEventIfBrowserIsVisible`. Payloads are objects, never JSON strings; JUCE
 * handles serialization across the WebView boundary itself.
 *
 * Security policy (defaults, documented in the package README):
 * - **Deny-by-default native allowlist.** `callNative` rejects any method not in
 *   the manifest the native host injects; the C++ side enforces the same list,
 *   so the allowlist is validated on both sides.
 * - **Payload validation.** Native-call payloads must be JSON-serializable and
 *   within {@link DEFAULT_MAX_PAYLOAD_BYTES}; oversized or cyclic payloads are
 *   rejected before they reach the transport.
 *
 * When no JUCE backend is present (a plain browser preview), the bridge falls
 * back to {@link createMockBridge} so the UI still renders.
 */

import {
  createMockBridge,
  type BaseParamInfo,
  type Bridge,
  type ParamInfoMap,
} from '@soundor/bridge';

/** Default cap on a native-call payload once serialized. */
export const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;

/**
 * The authoritative descriptor of what the UI may touch. The native host injects
 * it as `window.__SOUNDOR__`; the generated C++ derives it from the Soundor
 * config, so the JS and native allowlists cannot drift.
 */
export interface JuceBridgeManifest {
  /** Parameter info by id — seeds defaults and answers `getParamInfo`. */
  readonly parameters: ParamInfoMap;
  /** Allowlisted native-method names (deny-by-default). */
  readonly nativeMethods: readonly string[];
}

/**
 * The subset of JUCE's `window.__JUCE__.backend` the bridge uses, matching
 * `check_native_interop.js` exactly:
 * - `addEventListener(eventId, fn)` returns an opaque `[eventId, id]` handle;
 * - `removeEventListener(handle)` takes that same handle back;
 * - `emitEvent(eventId, payload)` sends a structured object (not a string).
 *
 * The handle is deliberately typed `unknown` so callers pass it back verbatim
 * rather than assuming its shape.
 */
export interface JuceBackend {
  addEventListener(eventId: string, fn: (payload: unknown) => void): unknown;
  removeEventListener(handle: unknown): void;
  emitEvent(eventId: string, payload: unknown): void;
}

/** The shape JUCE injects as `window.__JUCE__` with native integration on. */
export interface JuceFrontend {
  readonly backend: JuceBackend;
}

/** The event name the generated C++ editor listens on and emits to. */
export const SOUNDOR_EVENT = 'soundor';

declare global {
  interface Window {
    __JUCE__?: JuceFrontend;
    __SOUNDOR__?: JuceBridgeManifest;
  }
}

export interface CreateJuceBridgeOptions {
  /** Overrides `window.__SOUNDOR__` (required in non-WebView environments). */
  readonly manifest?: JuceBridgeManifest;
  /** Overrides `window.__JUCE__.backend` — supply a fake in tests. */
  readonly backend?: JuceBackend;
  /** Payload size cap; defaults to {@link DEFAULT_MAX_PAYLOAD_BYTES}. */
  readonly maxPayloadBytes?: number;
}

/** Inbound messages the native host sends to the UI. */
type InboundMessage =
  | { type: 'params'; values: Record<string, unknown> }
  | { type: 'event'; name: string; payload: unknown }
  | { type: 'result'; id: number; ok: true; value: unknown }
  | { type: 'result'; id: number; ok: false; error: string };

/**
 * Creates a JUCE-backed bridge, or a mock when no WebView channel is available.
 */
export function createJuceBridge(
  options: CreateJuceBridgeOptions = {},
): Bridge {
  const backend = options.backend ?? globalThis.window?.__JUCE__?.backend;
  const manifest = options.manifest ?? globalThis.window?.__SOUNDOR__;

  if (!backend) {
    // No JUCE backend (browser preview): degrade to the mock so the UI renders.
    return createMockBridge({ parameters: manifest?.parameters ?? {} });
  }
  if (!manifest) {
    throw new Error(
      'JUCE bridge: missing manifest. The native host must inject window.__SOUNDOR__, or pass { manifest }.',
    );
  }

  const maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  const allowedNative = new Set(manifest.nativeMethods);

  const values = new Map<string, unknown>();
  for (const [id, info] of Object.entries(manifest.parameters)) {
    values.set(id, (info as BaseParamInfo).default);
  }

  const paramListeners = new Map<string, Set<(value: unknown) => void>>();
  const eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let nextCallId = 1;

  const notify = (
    listeners: Map<string, Set<(value: unknown) => void>>,
    key: string,
    value: unknown,
  ): void => {
    for (const listener of listeners.get(key) ?? []) listener(value);
  };

  // JUCE delivers already-parsed objects on the "soundor" event. The handle is
  // kept so a future teardown could unsubscribe; the bridge lives for the app's
  // lifetime, so we mirror JUCE's own frontend and never remove it.
  backend.addEventListener(SOUNDOR_EVENT, (raw) => {
    if (typeof raw !== 'object' || raw === null) return; // Ignore junk frames.
    const message = raw as InboundMessage;
    switch (message.type) {
      case 'params':
        // One batched frame per tick; only notify parameters that changed.
        for (const [id, value] of Object.entries(message.values)) {
          if (values.get(id) !== value) {
            values.set(id, value);
            notify(paramListeners, id, value);
          }
        }
        break;
      case 'event':
        notify(eventListeners, message.name, message.payload);
        break;
      case 'result': {
        const entry = pending.get(message.id);
        if (!entry) break;
        pending.delete(message.id);
        if (message.ok) entry.resolve(message.value);
        else entry.reject(new Error(message.error));
        break;
      }
    }
  });

  const subscribe = (
    listeners: Map<string, Set<(value: unknown) => void>>,
    key: string,
    listener: (value: unknown) => void,
  ): (() => void) => {
    let set = listeners.get(key);
    if (!set) {
      set = new Set();
      listeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) listeners.delete(key);
    };
  };

  return {
    getParam(id) {
      return values.get(id) as never;
    },
    setParam(id, value) {
      values.set(id, value);
      notify(paramListeners, id, value);
      backend.emitEvent(SOUNDOR_EVENT, { type: 'setParam', id, value });
    },
    subscribeParam(id, listener) {
      return subscribe(
        paramListeners,
        id,
        listener as (value: unknown) => void,
      );
    },
    getParamInfo(id) {
      return manifest.parameters[id] as never;
    },
    getParamIds() {
      return Object.keys(manifest.parameters) as never;
    },
    callNative(name, payload) {
      if (!allowedNative.has(name)) {
        return Promise.reject(
          new Error(`Native method '${name}' is not allowlisted.`),
        );
      }
      const error = validatePayload(payload, maxPayloadBytes);
      if (error) return Promise.reject(error);

      const id = nextCallId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        backend.emitEvent(SOUNDOR_EVENT, { type: 'call', id, name, payload });
      }) as never;
    },
    subscribeEvent(name, handler) {
      return subscribe(
        eventListeners,
        name,
        handler as (value: unknown) => void,
      );
    },
  };
}

/**
 * Ensures a native-call payload is JSON-serializable and within the size cap.
 * JUCE serializes the object itself, so this only validates; it returns an
 * {@link Error} to reject with, or `undefined` when the payload is acceptable.
 */
function validatePayload(
  payload: unknown,
  maxBytes: number,
): Error | undefined {
  let serialized: string;
  try {
    serialized = JSON.stringify(payload ?? null);
  } catch {
    return new Error('Native-call payload is not JSON-serializable.');
  }
  const size = byteLength(serialized);
  if (size > maxBytes) {
    return new Error(
      `Native-call payload is too large (${size} bytes > ${maxBytes}).`,
    );
  }
  return undefined;
}

/** UTF-8 byte length, using TextEncoder when available. */
function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length;
  }
  return value.length;
}

/**
 * The factory the CLI's generated `virtual:soundor/bridge` module calls. Inside
 * a JUCE `WebBrowserComponent` it builds the real backend-backed bridge, using
 * the authoritative manifest the native host injects as `window.__SOUNDOR__`. In
 * a plain browser preview — no `window.__JUCE__.backend` — it returns a mock
 * seeded with the generated parameter defaults, so the UI shows real values
 * instead of an empty state.
 */
export function createBridge(seed: {
  readonly parameters: ParamInfoMap;
}): Bridge {
  if (globalThis.window?.__JUCE__?.backend) return createJuceBridge();
  return createMockBridge({ parameters: seed.parameters });
}

/**
 * The browser-side JUCE bridge — the concrete {@link Bridge} a React UI talks to
 * inside a JUCE `WebBrowserComponent`, in place of the in-memory mock. It speaks
 * a small JSON envelope protocol over the WebView channel (`window.__JUCE__`)
 * that the generated C++ `SoundorBridge` implements.
 *
 * Security policy (defaults, documented in the package README):
 * - **Deny-by-default native allowlist.** `callNative` rejects any method not in
 *   the manifest the native host injects; the C++ side enforces the same list,
 *   so the allowlist is validated on both sides.
 * - **Payload validation.** Native-call payloads must be JSON-serializable and
 *   within {@link DEFAULT_MAX_PAYLOAD_BYTES}; oversized or cyclic payloads are
 *   rejected before they reach the transport.
 *
 * When no WebView channel is present (a plain browser preview), the bridge falls
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
 * The minimal WebView channel the bridge needs. JUCE's `window.__JUCE__`
 * satisfies it; tests supply a fake. Messages are JSON strings.
 */
export interface JuceChannel {
  postMessage(message: string): void;
  addEventListener(listener: (message: string) => void): () => void;
}

export interface CreateJuceBridgeOptions {
  /** Overrides `window.__SOUNDOR__` (required in non-WebView environments). */
  readonly manifest?: JuceBridgeManifest;
  /** Overrides `window.__JUCE__` — supply a {@link JuceChannel} in tests. */
  readonly channel?: JuceChannel;
  /** Payload size cap; defaults to {@link DEFAULT_MAX_PAYLOAD_BYTES}. */
  readonly maxPayloadBytes?: number;
}

declare global {
  interface Window {
    __JUCE__?: JuceChannel;
    __SOUNDOR__?: JuceBridgeManifest;
  }
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
  const channel = options.channel ?? globalThis.window?.__JUCE__;
  const manifest = options.manifest ?? globalThis.window?.__SOUNDOR__;

  if (!channel) {
    // No WebView host (browser preview): degrade to the mock so the UI renders.
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

  channel.addEventListener((raw) => {
    let message: InboundMessage;
    try {
      message = JSON.parse(raw) as InboundMessage;
    } catch {
      return; // Ignore malformed frames rather than crash the UI.
    }
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
      channel.postMessage(JSON.stringify({ type: 'setParam', id, value }));
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
      const serialized = validatePayload(payload, maxPayloadBytes);
      if (serialized instanceof Error) return Promise.reject(serialized);

      const id = nextCallId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        channel.postMessage(
          JSON.stringify({ type: 'call', id, name, payload }),
        );
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
 * Returns the serialized string on success or an {@link Error} to reject with.
 */
function validatePayload(payload: unknown, maxBytes: number): string | Error {
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
  return serialized;
}

/** UTF-8 byte length, using TextEncoder when available. */
function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length;
  }
  return value.length;
}

/**
 * The ready bridge the CLI's `virtual:soundor/bridge` re-exports. Reads
 * `window.__JUCE__`/`window.__SOUNDOR__` (injected by the native host) at import
 * time, degrading to the mock when neither is present.
 */
export const bridge: Bridge = createJuceBridge();

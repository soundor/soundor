(function (exports, require, module) {"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.plugin = void 0;exports.snapshot = snapshot;exports.subscribe = subscribe;



  var _platform = require("soundor:internal/platform");





  var _console = require("soundor:internal/web/console"); // soundor:host — what the plugin knows about its host: the plugin's identity,
  // the audio setup, and the transport. Snapshots are plain, immutable data read
  // on the UI thread; nothing here touches the audio thread.
  function freeze(snapshot) {if (snapshot.transport !== null) {
      Object.freeze(snapshot.transport.timeSignature);
      Object.freeze(snapshot.transport);
    }
    return Object.freeze(snapshot);
  }

  var plugin = exports.plugin = Object.freeze({ id: _platform.pluginId, name: _platform.pluginName });

  /** The latest snapshot; replaced (never changed) when the host state changes. */
  var latest = null;

  /**
   * The current host state: sample rate, block size, host name, transport. The
   * same object until the state changes, so it works as a store snapshot (e.g.
   * React's useSyncExternalStore(subscribe, snapshot)).
   */
  function snapshot() {
    latest ??= freeze((0, _platform.hostSnapshot)());
    return latest;
  }

  var listeners = new Set();

  /**
   * Calls `listener` with the new snapshot whenever the host state changes —
   * while the transport plays, once per frame. Returns an unsubscribe function.
   */
  function subscribe(listener) {
    if (typeof listener !== 'function')
    throw new TypeError('subscribe() expects a function');
    var entry = { listener };
    listeners.add(entry);
    return () => {
      listeners.delete(entry);
    };
  }

  (0, _platform.setHostListener)((next) => {
    var frozen = freeze(next);
    latest = frozen;
    for (var { listener } of [...listeners]) {
      try {
        listener(frozen);
      } catch (error) {
        (0, _console.reportError)(error);
      }
    }
  });});
// Generated from native/src/modules/host/host.js by scripts/native-modules.mjs. Do not edit.

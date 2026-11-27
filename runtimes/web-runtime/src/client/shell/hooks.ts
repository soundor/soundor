import { useLayoutEffect, useState } from 'preact/hooks';

import type { AudioStatus, WebAudioHost } from '../audio';
import type { HostSnapshot, WebHost } from '../host';
import type { ParameterValue, WebParameter } from '../parameters';

/** The plugin's factory presets, as `soundor:presets` has them. */
export interface PresetCatalog {
  readonly factory: {
    list(): readonly { readonly id: string; readonly name: string }[];
    load(id: string): void;
  };
  getSnapshot(): {
    readonly factoryId: string | null;
    readonly modified: boolean;
  };
  subscribe(listener: () => void): () => void;
}

/**
 * A value read with `read()`, re-read whenever `subscribe` reports a change.
 * `source` names what `read` and `subscribe` come from: a new source
 * subscribes again.
 */
function useSubscribed<T>(
  source: object,
  read: () => T,
  subscribe: (listener: () => void) => () => void,
): T {
  const [value, setValue] = useState(read);
  // Subscribes as the shell renders, not after paint: no change is missed.
  useLayoutEffect(() => {
    const update = (): void => setValue(() => read());
    update();
    return subscribe(update);
    // `read` and `subscribe` come from `source`.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);
  return value;
}

/** The host's state: the transport, the audio format. */
export function useHostSnapshot(host: WebHost): HostSnapshot {
  return useSubscribed(
    host,
    () => host.snapshot(),
    (listener) => host.subscribe(listener),
  );
}

export function useAudioStatus(audio: WebAudioHost): AudioStatus {
  return useSubscribed(
    audio,
    () => audio.status,
    (listener) => audio.subscribe(listener),
  );
}

export function useParameterValue(
  parameter: WebParameter,
): ParameterValue<WebParameter['info']> {
  return useSubscribed(
    parameter,
    () => parameter.get(),
    (listener) => parameter.subscribe(listener),
  );
}

/** Which factory preset is selected, and whether it was changed since. */
export function usePresetSelection(
  presets: PresetCatalog,
): ReturnType<PresetCatalog['getSnapshot']> {
  return useSubscribed(
    presets,
    () => presets.getSnapshot(),
    (listener) => presets.subscribe(listener),
  );
}

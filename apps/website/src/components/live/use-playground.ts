import { type RefObject, useEffect, useRef, useState } from 'react';

import {
  isPlaygroundMessage,
  type PingMessage,
  type RunMessage,
} from '../../../playground/protocol.ts';
import type { Sources } from './sources';

export type PlaygroundStatus =
  | { readonly kind: 'loading' }
  | { readonly kind: 'running' }
  | { readonly kind: 'ok' }
  | { readonly kind: 'error'; readonly message: string };

export interface Playground {
  readonly status: PlaygroundStatus;
  /** Runs these files (the entry is the sources'), replacing what ran. */
  run(files: Readonly<Record<string, string>>): void;
  /** Runs the last files again, from the start. */
  replay(): void;
}

/**
 * The host in `frame`, in playground mode: it runs `sources` once it is
 * ready (each time it loads), then whatever `run()` sends it.
 */
export function usePlayground(
  frame: RefObject<HTMLIFrameElement | null>,
  sources: Sources | null,
): Playground {
  const [status, setStatus] = useState<PlaygroundStatus>({ kind: 'loading' });
  // How many times the host said it was ready: it says so on every load.
  const [loads, setLoads] = useState(0);
  const last = useRef<Readonly<Record<string, string>> | null>(null);
  const current = useRef(sources);
  current.current = sources;

  const run = (files: Readonly<Record<string, string>>): void => {
    const target = frame.current?.contentWindow;
    const entry = current.current?.entry;
    last.current = files;
    if (target == null || entry === undefined) return;
    setStatus({ kind: 'running' });
    const message: RunMessage = {
      type: 'soundor:playground:run',
      files: { ...files },
      entry,
    };
    target.postMessage(message, window.location.origin);
  };

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== window.location.origin ||
        !isPlaygroundMessage(event.data)
      ) {
        return;
      }
      if (event.data.type === 'soundor:playground:ready') {
        setLoads((count) => count + 1);
      }
      if (event.data.type === 'soundor:playground:result') {
        setStatus(
          event.data.error === null
            ? { kind: 'ok' }
            : { kind: 'error', message: event.data.error },
        );
      }
    };
    window.addEventListener('message', listen);
    // A host that started before this page listened said it was ready to
    // no one: ask again. (One that has not started yet will say so.)
    const ping: PingMessage = { type: 'soundor:playground:ping' };
    try {
      frame.current?.contentWindow?.postMessage(ping, window.location.origin);
    } catch {
      // Still about:blank, of no origin yet: it will say it is ready.
    }
    return () => window.removeEventListener('message', listen);
  }, [frame]);

  // A host that (re)loaded runs what ran last, or the sources.
  useEffect(() => {
    if (loads > 0 && sources !== null) run(last.current ?? sources.files);
    // `run` reads refs; it changes with nothing else.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [loads, sources]);

  return {
    status,
    run,
    replay: () => {
      if (last.current !== null) run(last.current);
    },
  };
}

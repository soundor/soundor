/**
 * Testing the host UI's Preact components: mounting them, and a fake audio
 * host whose state a test sets. Importing this module makes Testing
 * Library's events apply Preact's updates before the test looks.
 */

import { configure } from '@testing-library/dom';
import { render, type ComponentChild } from 'preact';
import { act } from 'preact/test-utils';

import {
  BUILTIN_AUDIO_INPUTS,
  type AudioStatus,
  type WebAudioInputInfo,
  type WebAudioHost,
} from '../audio';
import { Listeners } from '../listeners';

configure({
  eventWrapper: (callback) => {
    let result: unknown;
    act(() => {
      result = callback();
    });
    return result;
  },
});

export interface Mounted {
  readonly container: HTMLElement;
  /** Renders `node` in place of what was mounted, as a parent would. */
  rerender(node: ComponentChild): void;
  unmount(): void;
}

/** Renders `node` into a new element of the document's body. */
export function mount(node: ComponentChild): Mounted {
  const container = document.createElement('div');
  document.body.append(container);
  act(() => render(node, container));
  return {
    container,
    rerender: (next) => act(() => render(next, container)),
    unmount() {
      act(() => render(null, container));
      container.remove();
    },
  };
}

export interface FakeAudio {
  /** What the components get: the methods they call, recorded. */
  readonly audio: WebAudioHost;
  readonly calls: {
    start: number;
    setSource: (readonly unknown[])[];
    setMuted: boolean[];
    setVolume: number[];
  };
  /** Changes the status and tells the subscribers, inside act(). */
  set(status: Partial<AudioStatus>): void;
  /** Makes the next setSource() reject with `error`. */
  failSetSource(error: Error): void;
}

export function fakeAudio(
  initial: Partial<AudioStatus> = {},
  inputs: readonly WebAudioInputInfo[] = BUILTIN_AUDIO_INPUTS,
): FakeAudio {
  let status: AudioStatus = {
    state: 'off',
    sampleRate: null,
    source: 'oscillator',
    inputState: 'idle',
    inputError: null,
    fileName: null,
    volume: 0.8,
    muted: false,
    error: null,
    ...initial,
  };
  let sourceError: Error | null = null;
  const listeners = new Listeners<AudioStatus>();
  const calls: FakeAudio['calls'] = {
    start: 0,
    setSource: [],
    setMuted: [],
    setVolume: [],
  };
  const audio = {
    inputs,
    get status() {
      return status;
    },
    subscribe: (listener: (value: AudioStatus) => void) =>
      listeners.add(listener, 'subscribe()'),
    start: () => {
      calls.start++;
      return Promise.resolve();
    },
    setSource: (...args: unknown[]) => {
      calls.setSource.push(args);
      const error = sourceError;
      sourceError = null;
      return error === null ? Promise.resolve() : Promise.reject(error);
    },
    setMuted: (muted: boolean) => calls.setMuted.push(muted),
    setVolume: (volume: number) => calls.setVolume.push(volume),
  };
  return {
    audio: audio as unknown as WebAudioHost,
    calls,
    set(next) {
      act(() => {
        status = { ...status, ...next };
        listeners.notify(status);
      });
    },
    failSetSource(error) {
      sourceError = error;
    },
  };
}

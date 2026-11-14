import { createTestRuntime, getTestRuntime } from '@soundor/test-runtime';
import type {} from '@soundor/vitest';
import {
  plugin,
  environment,
  getHostState as snapshot,
  subscribeHostState as subscribe,
} from 'soundor:host';
import { channels, events, loadPreset, probe } from 'soundor:native';
import { parameters } from 'soundor:parameters';
import {
  createTextInput,
  root,
  isVisible,
  isFocused,
  subscribeVisibility,
  subscribeFocus,
} from 'soundor:ui';
import { expect, test, vi } from 'vitest';

import {
  testParameters,
  testEditor,
  testHost,
  mockNative,
  emitNative,
  publishChannel,
  screen,
  userEvent,
} from './index';

test('focus matcher observes traversal and reports both sides of failures', async () => {
  const a = createTextInput(),
    b = createTextInput();
  a.accessibility = { label: 'First' };
  b.accessibility = { label: 'Second' };
  root.appendChild(a);
  root.appendChild(b);
  const user = userEvent.setup();
  expect(screen.getByLabelText('First')).not.toHaveFocus();
  await user.tab();
  expect(a).toHaveFocus();
  expect(b).not.toHaveFocus();
  expect(() => expect(b).toHaveFocus()).toThrow(
    /Expected input.*Second.*to have focus.*Actual focus: input.*First/s,
  );
  expect(() => expect(a).not.toHaveFocus()).toThrow(/not to have focus/);
  await user.tab();
  expect(b).toHaveFocus();
  expect(a).not.toHaveFocus();
  a.remove();
  expect(() => expect(a).not.toHaveFocus()).toThrow('connected Soundor node');
  const foreign = createTestRuntime();
  try {
    expect(() => expect(foreign.root).not.toHaveFocus()).toThrow(
      'another runtime',
    );
    expect(() => expect(null).not.toHaveFocus()).toThrow(
      'expects a Soundor node',
    );
  } finally {
    foreign.dispose();
  }
});

let prior: ReturnType<typeof createTextInput>;
test('retains a node only to verify stale-node rejection', () => {
  prior = createTextInput();
  root.appendChild(prior);
  expect(root.children).toContain(prior);
});
test('rejects a previous test node even with negation', () => {
  expect(() => expect(prior).not.toHaveFocus()).toThrow('another runtime');
});
test('parameter setup uses the existing clamping and subscription behavior', () => {
  const changed = vi.fn<(...args: unknown[]) => void>();
  parameters.gain.subscribe(changed);
  testParameters.set('gain', 2);
  expect(parameters.gain.get()).toBe(1);
  expect(changed).toHaveBeenCalledExactlyOnceWith(1);
  testParameters.set('gain', 1);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(() => testParameters.set('missing', 0)).toThrow(
    "Unknown Soundor parameter 'missing'",
  );
  expect(() => testParameters.set('__proto__', 0)).toThrow(
    'Unknown Soundor parameter',
  );
  expect(() => testParameters.set('gain', false)).toThrow(
    "Parameter 'gain' expects a number",
  );
  expect(() => testParameters.set('gain', NaN)).toThrow('expects a number');
});
test('host setup preserves the snapshot and transport contract and notifies subscribers', () => {
  expect(Object.isFrozen(plugin)).toBe(true);
  expect(Object.isFrozen(environment)).toBe(true);
  const changed = vi.fn<(...args: unknown[]) => void>(),
    initial = snapshot();
  subscribe(changed);
  const transport = {
    playing: true,
    recording: false,
    looping: false,
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    ppqPosition: 8,
    barStartPpq: 8,
    timeInSeconds: 4,
    timeInSamples: 192000,
  };
  testHost.set({ hostName: 'Test DAW', transport });
  expect(snapshot()).toEqual({ ...initial, hostName: 'Test DAW', transport });
  expect(changed).toHaveBeenCalledExactlyOnceWith(snapshot());
});
test('native mocks accept sync and async vi.fn functions and propagate exceptions', async () => {
  const load = vi.fn<() => Promise<string>>(async () => 'Warm'),
    sync = vi.fn<() => number>(() => 42);
  mockNative('loadPreset', load);
  mockNative('probe', sync);
  expect(await loadPreset()).toBe('Warm');
  expect(probe()).toBe(42);
  expect(load).toHaveBeenCalledOnce();
  expect(sync).toHaveBeenCalledOnce();
  expect(() => mockNative('missing', sync)).toThrow(
    "Unknown soundor:native method 'missing'",
  );
  expect(() => mockNative('probe', null as never)).toThrow(
    'must be a function',
  );
  mockNative('probe', () => {
    throw new Error('sync failure');
  });
  expect(() => probe()).toThrow('sync failure');
  mockNative('loadPreset', async () => {
    throw new Error('async failure');
  });
  await expect(loadPreset()).rejects.toThrow('async failure');
});
test('setup state and native registrations are isolated per test', async () => {
  expect(parameters.gain.get()).toBe(0.5);
  expect(snapshot().hostName).toBe('Soundor Test');
  expect(snapshot().transport).toBeNull();
  expect(() => probe()).toThrow('requires a configured test mock');
  await expect(loadPreset()).rejects.toThrow('requires a configured test mock');
});
test('focus matcher rejects a disposed current runtime', () => {
  const node = createTextInput();
  root.appendChild(node);
  getTestRuntime().dispose();
  expect(() => expect(node).not.toHaveFocus()).toThrow('disposed');
});

test('parameter setup preserves boolean, enum, and integer constraints', () => {
  testParameters.set('enabled', false);
  testParameters.set('mode', 'b');
  testParameters.set('voices', 3.7);
  expect(parameters.voices.get()).toBe(4);
  expect(() => testParameters.set('enabled', 1)).toThrow('expects a boolean');
  expect(() => testParameters.set('mode', 'c')).toThrow(
    "expects one of 'a', 'b'",
  );
  expect(() => testParameters.set('voices', '4')).toThrow('expects a number');
});
test('emitNative publishes a declared native event to its subscribers', () => {
  const loaded = vi.fn<(...args: unknown[]) => void>();
  const stop = events.presetLoaded.subscribe(loaded);
  emitNative('presetLoaded', { path: 'a.json' });
  expect(loaded).toHaveBeenCalledExactlyOnceWith({ path: 'a.json' });
  stop();
  emitNative('presetLoaded', { path: 'b.json' });
  expect(loaded).toHaveBeenCalledOnce();
  expect(() => emitNative('missing')).toThrow(
    "Unknown soundor:native event 'missing'",
  );
});
test('publishChannel sets a declared native channel and notifies its subscribers', () => {
  expect(channels.level.get()).toBeUndefined();
  const seen = vi.fn<(...args: unknown[]) => void>();
  const stop = channels.level.subscribe(seen);
  publishChannel('level', 0.5);
  publishChannel('level', 0.75);
  expect(seen.mock.calls).toEqual([
    [0.5, 1],
    [0.75, 2],
  ]);
  expect(channels.level.get()).toBe(0.75);
  stop();
  publishChannel('level', 1);
  expect(seen).toHaveBeenCalledTimes(2);
  expect(channels.level.get()).toBe(1);
  expect(() => publishChannel('missing', 1)).toThrow(
    "Unknown soundor:native channel 'missing'",
  );
});

test('editor helpers drive visibility and focus independently through soundor:ui', () => {
  const visible = vi.fn<(value: boolean) => void>();
  const focused = vi.fn<(value: boolean) => void>();
  const stopVisible = subscribeVisibility(visible);
  const stopFocused = subscribeFocus(focused);
  expect(isVisible()).toBe(true);
  expect(isFocused()).toBe(false);
  testEditor.setFocused(true);
  testEditor.setFocused(true);
  expect(isFocused()).toBe(true);
  expect(isVisible()).toBe(true);
  testEditor.setVisible(false);
  testEditor.setVisible(false);
  expect(isVisible()).toBe(false);
  expect(focused.mock.calls).toEqual([[true]]);
  testEditor.setFocused(false);
  testEditor.setVisible(true);
  expect(focused.mock.calls).toEqual([[true], [false]]);
  expect(visible.mock.calls).toEqual([[false], [true]]);
  stopVisible();
  stopFocused();
});

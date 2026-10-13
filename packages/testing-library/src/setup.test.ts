import { createTestRuntime, getTestRuntime } from '@soundor/test-runtime';
import type {} from '@soundor/vitest';
import { snapshot, subscribe } from 'soundor:host';
import { loadPreset, probe } from 'soundor:native';
import { parameters } from 'soundor:parameters';
import { createTextInput, root } from 'soundor:ui';
import { expect, test, vi } from 'vitest';

import {
  testParameters,
  testHost,
  mockNative,
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
});
test('rejects a previous test node even with negation', () => {
  expect(() => expect(prior).not.toHaveFocus()).toThrow('another runtime');
});
test('parameter setup uses the existing clamping and subscription behavior', () => {
  const changed = vi.fn();
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
  const changed = vi.fn(),
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
  const load = vi.fn(async () => 'Warm'),
    sync = vi.fn(() => 42);
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

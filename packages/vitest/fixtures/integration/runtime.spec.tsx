import { getTestRuntime } from '@soundor/vitest';
import { readText } from 'soundor:fs';
import { snapshot, subscribe } from 'soundor:host';
import { probe, load } from 'soundor:native';
import { parameters } from 'soundor:parameters';
import { storage } from 'soundor:storage';
import {
  root,
  overlayRoot,
  createTextInput,
  createView,
  clipboard,
} from 'soundor:ui';
import { test, expect, vi, afterEach } from 'vitest';
const gain = parameters.gain;
const userMock = vi.fn<() => void>();
let previous;
function expectFreshRuntime() {
  expect(root).toBe(getTestRuntime().root);
  expect(overlayRoot).toBe(getTestRuntime().overlayRoot);
  expect(root.children).toEqual([]);
  expect(gain.get()).toBe(0.5);
  expect(previous?.isDisposed ?? true).toBe(true);
}
afterEach(() => {
  previous = getTestRuntime();
});
test('normal imports dispatch to the active runtime', async () => {
  expectFreshRuntime();
  const node = createTextInput({ value: 'Soundor' });
  root.appendChild(node);
  node.focus();
  expect(getTestRuntime().focusedNode()).toBe(node);
  gain.set(8);
  expect(gain.get()).toBe(1);
  const onHost = vi.fn<() => void>();
  subscribe(onHost);
  getTestRuntime().setHost({ hostName: 'Test DAW' });
  expect(snapshot().hostName).toBe('Test DAW');
  expect(onHost).toHaveBeenCalledTimes(1);
  await storage.set('preset', { value: 3 });
  await clipboard.writeText('copy');
  getTestRuntime().mockNative(
    'probe',
    vi.fn(() => 42),
  );
  expect(probe()).toBe(42);
  getTestRuntime().mockNative(
    'load',
    vi.fn(() => 7),
  );
  expect(await load()).toBe(7);
  userMock();
  const animationNode = createView();
  root.appendChild(animationNode);
  animationNode.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 100 });
  getTestRuntime().advanceTime(50);
  expect(animationNode.presentation.opacity).toBeCloseTo(0.5);
  await expect(readText('file')).rejects.toThrow('unavailable');
});
test('all Soundor state resets without resetting unrelated mocks', async () => {
  expectFreshRuntime();
  expect(getTestRuntime().focusedNode()).toBeNull();
  expect(getTestRuntime().animations.size).toBe(0);
  expect(snapshot().hostName).not.toBe('Test DAW');
  expect(await storage.get('preset')).toBeUndefined();
  expect(await clipboard.readText()).toBe('');
  expect(() => probe()).toThrow('configured test mock');
  expect(userMock).toHaveBeenCalledTimes(1);
});

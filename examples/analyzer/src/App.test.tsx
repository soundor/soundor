import {
  testEditor,
  publishChannel,
  render,
  screen,
} from '@soundor/testing-library/react';
import { channels } from 'soundor:native';
import { expect, test } from 'vitest';

import { App } from './App';
import { heightOf, hold } from './spectrum';

test('shows the peak the plugin publishes', async () => {
  await render(<App />);
  expect(screen.getByText('Peak -∞ dB')).toBeDefined();
  publishChannel('peak', -6.02);
  expect(screen.getByText('Peak -6.0 dB')).toBeDefined();
});

test('takes each spectrum it is published', async () => {
  await render(<App />);
  expect(screen.getByLabelText("Spectrum of the plugin's audio")).toBeDefined();
  publishChannel('spectrum', new Float32Array([-12, -48, -96]));
  expect(Array.from(channels.spectrum.get()!)).toEqual([-12, -48, -96]);
});

test('bars rise at once and fall slowly', () => {
  expect(heightOf(0)).toBe(1);
  expect(heightOf(-96)).toBe(0);
  expect(heightOf(-200)).toBe(0);
  const risen = hold(new Float32Array(0), new Float32Array([0, -48]), 0.1);
  expect(Array.from(risen)).toEqual([1, 0.5]);
  const fallen = hold(risen, new Float32Array([-96, -96]), 0.1);
  expect(Array.from(fallen).map((value) => value.toFixed(2))).toEqual([
    '0.90',
    '0.40',
  ]);
});

test('pauses the analyzer UI while hidden and resumes with the latest peak', async () => {
  await render(<App />);
  testEditor.setVisible(false);
  expect(screen.queryByLabelText("Spectrum of the plugin's audio")).toBeNull();
  publishChannel('peak', -12);
  expect(screen.queryByText('Peak -12.0 dB')).toBeNull();
  testEditor.setVisible(true);
  expect(screen.getByLabelText("Spectrum of the plugin's audio")).toBeDefined();
  expect(screen.getByText('Peak -12.0 dB')).toBeDefined();
});

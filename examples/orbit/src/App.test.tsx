import {
  render,
  screen,
  userEvent,
  testParameters,
} from '@soundor/testing-library/react';
import { parameters } from 'soundor:parameters';
import { expect, test } from 'vitest';

import { Delay, type DelaySettings } from '../runtimes/web/src/delay';
import { App } from './App';

test('presets set the real parameters, release Hold, and survive host automation', async () => {
  await render(<App />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('togglebutton', { name: 'Hold' }));
  expect(parameters.hold.get()).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Next preset' }));
  expect(parameters.hold.get()).toBe(false);
  expect(parameters.time1.get()).toBe(0.38);
  expect(parameters.sync.get()).toBe(false);
  expect(screen.getByText('Warm magnetic')).toBeDefined();
  testParameters.set('mix', 0.7);
  expect(
    screen.getByRole('adjustable', { name: 'Mix' }).accessibility.value?.now,
  ).toBe(0.7);
});

test('echoes and knobs support keyboard editing; toggles expose their state', async () => {
  await render(<App />);
  const user = userEvent.setup();
  screen.getByRole('adjustable', { name: 'Echo 1 time' }).focus();
  await user.keyboard('{ArrowRight}{ArrowDown}');
  expect(parameters.time1.get()).toBe(0.875);
  expect(parameters.level1.get()).toBeCloseTo(0.75);
  screen.getByRole('adjustable', { name: 'Feedback' }).focus();
  await user.keyboard('{ArrowUp}');
  expect(parameters.feedback.get()).toBeGreaterThan(0.48);
  await user.keyboard('{Home}');
  expect(parameters.feedback.get()).toBe(0.48);
  await user.click(screen.getByRole('togglebutton', { name: 'Bypass' }));
  expect(parameters.bypass.get()).toBe(true);
  expect(
    screen.getByRole('togglebutton', { name: 'Bypass' }).accessibility.state
      ?.checked,
  ).toBe(true);
});

const settings = (): DelaySettings => ({
  times: [0.1, 0.2, 0.3],
  levels: [1, 0, 0],
  feedback: 0,
  tone: 1,
  motion: 0,
  spread: 1,
  mix: 1,
  hold: false,
  bypass: false,
});

test('the wet impulse arrives at its tap time and pans left; bypass returns dry audio', () => {
  const rate = 8000,
    delay = new Delay(rate),
    state = settings();
  delay.configure(state);
  for (let i = 0; i < rate; i++) delay.tick(0, 0, state);
  let first = -1,
    leftEnergy = 0,
    rightEnergy = 0;
  for (let i = 0; i < 2000; i++) {
    delay.tick(i === 0 ? 1 : 0, i === 0 ? 1 : 0, state);
    if (Math.abs(delay.left) > 0.001 && first === -1) first = i;
    leftEnergy += delay.left ** 2;
    rightEnergy += delay.right ** 2;
  }
  expect(first).toBeGreaterThanOrEqual(799);
  expect(first).toBeLessThanOrEqual(802);
  expect(leftEnergy).toBeGreaterThan(0.05);
  expect(rightEnergy).toBeLessThan(1e-10);
  state.bypass = true;
  for (let i = 0; i < rate; i++) delay.tick(0.25, -0.125, state);
  expect(delay.left).toBeCloseTo(0.25, 6);
  expect(delay.right).toBeCloseTo(-0.125, 6);
});

test('Hold keeps a captured loop alive and excludes new input from that loop', () => {
  const rate = 8000,
    a = new Delay(rate),
    b = new Delay(rate),
    state = settings();
  a.configure(state);
  b.configure(state);
  for (let i = 0; i < rate; i++) {
    const input = Math.sin(i * 0.07) * 0.3;
    a.tick(input, input, state);
    b.tick(input, input, state);
  }
  state.hold = true;
  let energy = 0,
    maximumDifference = 0;
  for (let i = 0; i < rate * 2; i++) {
    a.tick(0, 0, state);
    b.tick(0.9, 0.9, state);
    if (i > rate) {
      energy += a.left ** 2;
      maximumDifference = Math.max(
        maximumDifference,
        Math.abs(a.left - b.left),
      );
    }
  }
  expect(energy).toBeGreaterThan(1);
  expect(maximumDifference).toBeLessThan(1e-6);
});

test('maximum feedback and moving taps stay finite at common sample rates', () => {
  let maximum = 0;
  for (const rate of [44100, 48000, 96000]) {
    const delay = new Delay(rate),
      state = settings();
    Object.assign(state, { feedback: 0.92, motion: 1, levels: [1, 1, 1] });
    delay.configure(state);
    for (let i = 0; i < rate; i++) {
      if (i === rate / 2) state.times = [0.02, 0.4, 0.8];
      delay.tick(Math.sin(i * 0.08) * 0.8, Math.cos(i * 0.09) * 0.8, state);
      maximum = Math.max(maximum, Math.abs(delay.left), Math.abs(delay.right));
    }
  }
  expect(Number.isFinite(maximum)).toBe(true);
  expect(maximum).toBeLessThan(2);
});

import { expect, it } from 'vitest';

import {
  registrationSchema,
  requestSchema,
  responseSchema,
  runtimeEventSchema,
  runtimeCommandSchema,
} from './index';

it('validates dispatcher-stamped generations separately from browser requests', () => {
  const command = {
    type: 'request',
    id: '1',
    targetId: 'target',
    method: 'UI.clearHighlight',
    generation: 2,
    params: {},
  };
  expect(runtimeCommandSchema.safeParse(command).success).toBe(true);
  expect(requestSchema.safeParse(command).success).toBe(false);
  expect(
    runtimeCommandSchema.safeParse({ ...command, generation: 0 }).success,
  ).toBe(false);
});

it('validates version negotiation and instance capabilities', () => {
  const target = {
    version: 1,
    sessionId: 'session',
    name: 'Plugin',
    runtime: 'third-party',
    generation: 1,
    capabilities: ['inspector'],
  };
  expect(registrationSchema.safeParse(target).success).toBe(true);
  expect(registrationSchema.safeParse({ ...target, version: 2 }).success).toBe(
    false,
  );
  expect(
    registrationSchema.safeParse({ ...target, capabilities: ['invented'] })
      .success,
  ).toBe(false);
});
it('validates methods, payloads and generation-scoped references', () => {
  const request = {
    type: 'request',
    id: '1',
    targetId: 'target',
    method: 'UI.getNode',
    params: { node: { generation: 1, id: 'node' } },
  };
  expect(requestSchema.safeParse(request).success).toBe(true);
  expect(
    requestSchema.safeParse({ ...request, targetId: undefined }).success,
  ).toBe(false);
  expect(
    requestSchema.safeParse({
      ...request,
      params: { node: { generation: 0, id: 'node' } },
    }).success,
  ).toBe(false);
  expect(
    requestSchema.safeParse({ ...request, params: { pointer: 123 } }).success,
  ).toBe(false);
});
it('requires structured responses and typed events', () => {
  expect(
    responseSchema.safeParse({ type: 'response', id: '1', result: null })
      .success,
  ).toBe(true);
  expect(
    responseSchema.safeParse({
      type: 'response',
      id: '1',
      result: null,
      error: { code: 'INTERNAL', message: 'broken' },
    }).success,
  ).toBe(false);
  expect(
    runtimeEventSchema.safeParse({
      type: 'event',
      event: 'UI.nodeSelected',
      data: { node: { generation: 1, id: 'node' } },
    }).success,
  ).toBe(true);
  expect(
    runtimeEventSchema.safeParse({
      type: 'event',
      event: 'UI.nodeSelected',
      data: {},
    }).success,
  ).toBe(false);
});

it('validates bounded animation lifecycle changes and requires typed diagnostics', async () => {
  const { metricsSchema, animationSchema } = await import('./index');
  const metrics = {
    generation: 1,
    recording: false,
    elapsedMs: 0,
    frameCount: 0,
    delayedTicks: 0,
    tickIntervalMs: 0,
    phases: {},
    frames: [],
  };
  expect(metricsSchema.safeParse(metrics).success).toBe(true);
  expect(
    metricsSchema.safeParse({ ...metrics, gpuExecutionMs: 2 }).success,
  ).toBe(false);
  expect(
    metricsSchema.safeParse({ ...metrics, tickIntervalMs: Infinity }).success,
  ).toBe(false);
  const change = {
    id: '1',
    playbackGeneration: 0,
    state: 'cancelled',
    node: { generation: 1, id: '3' },
  };
  expect(
    runtimeEventSchema.safeParse({
      type: 'event',
      event: 'Animation.changed',
      data: { generation: 1, changes: [change], truncated: false },
    }).success,
  ).toBe(true);
  expect(
    runtimeEventSchema.safeParse({
      type: 'event',
      event: 'Animation.changed',
      data: {
        generation: 1,
        changes: Array(129).fill(change),
        truncated: true,
      },
    }).success,
  ).toBe(false);
  const animation = {
    id: '1',
    playbackGeneration: 0,
    state: 'running',
    kind: 'timing',
    elapsedMs: 1,
    durationMs: null,
    durationScope: 'iteration',
    delayMs: 0,
    iterations: null,
    targets: [],
    targetsTruncated: false,
  };
  expect(animationSchema.safeParse(animation).success).toBe(true);
  expect(
    animationSchema.safeParse({ ...animation, elapsedMs: -1 }).success,
  ).toBe(false);
});

it('validates input commands and keeps them behind their own capability and the lease', async () => {
  const { methodCapability, requiresControl, methodParams } =
    await import('./index');
  const pointer = methodParams['Input.dispatchPointer'];
  expect(pointer.safeParse({ action: 'click', x: 1, y: 2 }).success).toBe(true);
  expect(pointer.safeParse({ action: 'down' }).success).toBe(true);
  expect(pointer.safeParse({ action: 'move' }).success).toBe(false);
  expect(pointer.safeParse({ action: 'down', x: 1 }).success).toBe(false);
  expect(
    pointer.safeParse({ action: 'move', x: Number.NaN, y: 0 }).success,
  ).toBe(false);
  expect(
    pointer.safeParse({ action: 'click', x: 0, y: 0, button: 'back' }).success,
  ).toBe(false);
  expect(
    methodParams['Input.dispatchKey'].safeParse({
      action: 'press',
      key: 'Enter',
      modifiers: ['Shift'],
    }).success,
  ).toBe(true);
  expect(
    methodParams['Input.typeText'].safeParse({ text: 'x'.repeat(1025) })
      .success,
  ).toBe(false);
  for (const method of [
    'Input.dispatchPointer',
    'Input.dispatchWheel',
    'Input.dispatchKey',
    'Input.typeText',
    'Input.focus',
  ] as const) {
    expect(methodCapability(method)).toBe('input');
    expect(requiresControl(method)).toBe(true);
  }
  // Hit testing reads; it needs inspection, not control.
  expect(methodCapability('UI.hitTest')).toBe('inspector');
  expect(requiresControl('UI.hitTest')).toBe(false);
});

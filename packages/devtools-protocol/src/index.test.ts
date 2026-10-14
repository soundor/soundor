import { expect, it } from 'vitest';

import {
  registrationSchema,
  requestSchema,
  responseSchema,
  runtimeEventSchema,
} from './index';

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

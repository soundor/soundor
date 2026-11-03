// The process and its protocol: framing, malformed requests, timeouts,
// crashes, aborts and closing.
import { spawn } from 'node:child_process';

import { afterEach, describe, expect, test } from 'vitest';

import type { Vst3HostError } from '../../src/index.ts';
import { FrameDecoder, encodeFrame } from '../../src/protocol.ts';
import { CRASH, GAIN, HANG, closeAll, launch } from './fixtures.ts';

afterEach(closeAll);

/** The executable spoken to directly, frame by frame. */
function raw() {
  const child = spawn(
    process.env.SOUNDOR_VST3_HOST_EXECUTABLE!,
    ['--headless', '--max-payload', '1024'],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  const decoder = new FrameDecoder();
  const frames: { header: Record<string, unknown> }[] = [];
  const waiters: (() => void)[] = [];
  child.stdout.on('data', (chunk: Buffer) => {
    for (const frame of decoder.push(chunk)) frames.push(frame as never);
    for (const waiter of waiters.splice(0)) waiter();
  });
  const exited = new Promise<number | null>((resolve) =>
    child.once('exit', resolve),
  );
  return {
    child,
    exited,
    send(header: unknown, payload?: Uint8Array) {
      for (const part of encodeFrame(header, payload)) child.stdin.write(part);
    },
    write(bytes: Uint8Array) {
      child.stdin.write(bytes);
    },
    async next(): Promise<Record<string, unknown>> {
      while (frames.length === 0)
        await new Promise<void>((resolve) => waiters.push(resolve));
      return frames.shift()!.header;
    },
  };
}

describe('protocol', () => {
  test('starts with a versioned handshake', async () => {
    const host = raw();
    expect(await host.next()).toMatchObject({
      event: 'hello',
      params: { protocol: 1, mode: 'headless', maxPayloadBytes: 1024 },
    });
    host.send({ id: 1, method: 'ping' });
    expect(await host.next()).toEqual({ id: 1, result: {} });
    host.child.stdin.end();
    expect(await host.exited).toBe(0);
  });

  test('answers malformed requests and carries on', async () => {
    const host = raw();
    await host.next();
    const header = Buffer.from('{not json');
    const prefix = Buffer.alloc(12);
    prefix.write('SVH1', 0, 'latin1');
    prefix.writeUInt32LE(header.length, 4);
    host.write(Buffer.concat([prefix, header]));
    expect(await host.next()).toMatchObject({ event: 'protocolError' });
    host.send({ method: 'ping' });
    expect(await host.next()).toMatchObject({
      event: 'protocolError',
      params: { message: /no numeric id/ },
    });
    host.send({ id: 2 });
    expect(await host.next()).toMatchObject({
      id: 2,
      error: { code: 'invalid-request' },
    });
    host.send({ id: 3, method: 'dance' });
    expect(await host.next()).toMatchObject({
      id: 3,
      error: { code: 'unknown-method' },
    });
    host.send({ id: 4, method: 'getParameters' });
    expect(await host.next()).toMatchObject({
      id: 4,
      error: { code: 'invalid-state' },
    });
    host.send({ id: 5, method: 'load', params: { path: 7 } });
    expect(await host.next()).toMatchObject({
      id: 5,
      error: { code: 'invalid-request' },
    });
    host.send({ id: 6, method: 'ping' });
    expect(await host.next()).toEqual({ id: 6, result: {} });
    host.child.stdin.end();
    await host.exited;
  });

  test('stops at a stream it cannot resynchronize', async () => {
    const host = raw();
    await host.next();
    host.write(Buffer.from('GET / HTTP/1.1\r\n\r\n'));
    expect(await host.next()).toMatchObject({
      event: 'protocolError',
      params: { message: /magic/ },
    });
    expect(await host.exited).toBe(2);
  });

  test('refuses a payload over its limit before reading it', async () => {
    const host = raw();
    await host.next();
    host.send(
      { id: 1, method: 'process', params: { frames: 1000 } },
      new Uint8Array(2048),
    );
    expect(await host.next()).toMatchObject({
      event: 'protocolError',
      params: { message: /exceeds the limit of 1024/ },
    });
    expect(await host.exited).toBe(2);
  });

  test('keeps requests over the client limit from being sent', async () => {
    const host = await launch('Fixture Gain', { maxPayloadBytes: 4096 });
    const big = new Float32Array(1024);
    const error = await host
      .process({ inputs: [[big, big]] })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'message-too-large' });
    expect((await host.process({ frames: 16 })).frames).toBe(16);
  });
});

describe('failures', () => {
  test('a crash fails the request and every later one', async () => {
    const host = await launch('Fixture Gain');
    await host.setParameter(CRASH, 1);
    const crashed = host.process({ frames: 8 });
    const queued = host.getParameters();
    const error = (await crashed.catch((e: unknown) => e)) as Vst3HostError;
    expect(error.code).toBe('host-exited');
    expect(error.details?.code ?? error.details?.signal).toBeTruthy();
    expect(await queued.catch((e: unknown) => (e as Vst3HostError).code)).toBe(
      'host-exited',
    );
    expect(
      await host.getInfo().catch((e: unknown) => (e as Vst3HostError).code),
    ).toBe('host-exited');
    expect(await host.exited).toBeDefined();
    await host.close();
  });

  test('a request that never ends times out and stops the host', async () => {
    const host = await launch('Fixture Gain');
    await host.setParameter(HANG, 1);
    const started = Date.now();
    const error = (await host
      .process({ frames: 8, timeout: 500 })
      .catch((e: unknown) => e)) as Vst3HostError;
    expect(error.code).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(10_000);
    const { signal, code } = await host.exited;
    expect(signal ?? code).toBeTruthy();
    expect(
      await host.getInfo().catch((e: unknown) => (e as Vst3HostError).code),
    ).toBe('timeout');
  });

  test('aborts a queued request without sending it', async () => {
    const host = await launch('Fixture Gain');
    const controller = new AbortController();
    const first = host.process({ frames: 48000 });
    const second = host.setParameter(GAIN, 1, { signal: controller.signal });
    controller.abort();
    expect(await second.catch((e: unknown) => (e as Vst3HostError).code)).toBe(
      'aborted',
    );
    await first;
    expect((await host.getParameter(GAIN)).normalized).toBe(0.5);
    const already = await host
      .getParameters({ signal: AbortSignal.abort() })
      .catch((e: unknown) => (e as Vst3HostError).code);
    expect(already).toBe('aborted');
  });
});

describe('closing', () => {
  test('is clean, idempotent and final', async () => {
    const host = await launch('Fixture Gain');
    const pid = host.pid!;
    const first = host.close();
    expect(host.close()).toBe(first);
    expect(await first).toEqual({ code: 0, signal: null });
    expect(() => process.kill(pid, 0)).toThrow(/ESRCH/);
    expect(
      await host.getInfo().catch((e: unknown) => (e as Vst3HostError).code),
    ).toBe('closed');
  });

  test('passes the environment to the host', async () => {
    const host = await launch('Fixture Gain', {
      env: { SOUNDOR_DEVTOOLS_SESSION: 'test-session' },
      inheritEnv: false,
    });
    expect(host.identity.mode).toBe('headless');
  });
});

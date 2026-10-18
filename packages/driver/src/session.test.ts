import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isDriverError } from './errors';
import { parseEndpoint, readDescriptor } from './session';

const key = 'a'.repeat(64);
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'soundor-driver-session-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function descriptor(value: unknown, mode = 0o600): Promise<string> {
  const path = join(directory, 'session.json');
  await writeFile(path, JSON.stringify(value), { mode });
  await chmod(path, mode);
  return path;
}

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!isDriverError(error)) throw new Error('Expected a DriverError');
  return error;
}

describe('session descriptors', () => {
  it('reads the endpoint and browser key, ignoring the runtime token', async () => {
    const path = await descriptor({
      version: 2,
      project: '/project',
      endpoint: 'http://127.0.0.1:4545',
      sessionId: 'session',
      token: 'b'.repeat(64),
      browserKey: key,
    });
    const credentials = await readDescriptor(path);
    expect(credentials).toEqual({
      endpoint: new URL('http://127.0.0.1:4545'),
      browserKey: key,
    });
  });

  it('reports a missing descriptor as an ended session', async () => {
    const error = await failure(readDescriptor(join(directory, 'gone.json')));
    expect(error.code).toBe('INVALID_DESCRIPTOR');
    expect(error.message).toContain('session ended');
  });

  it.skipIf(process.platform === 'win32')(
    'refuses a descriptor other users can read',
    async () => {
      const path = await descriptor(
        { version: 2, endpoint: 'http://127.0.0.1:1', browserKey: key },
        0o644,
      );
      const error = await failure(readDescriptor(path));
      expect(error.code).toBe('INVALID_DESCRIPTOR');
      expect(error.message).toContain('0600');
    },
  );

  it('rejects malformed descriptors without echoing their contents', async () => {
    const secret = 'c'.repeat(63);
    const path = await descriptor({
      version: 2,
      endpoint: 'http://127.0.0.1:1',
      browserKey: secret,
    });
    const error = await failure(readDescriptor(path));
    expect(error.code).toBe('INVALID_DESCRIPTOR');
    expect(error.message).not.toContain(secret);
    await writeFile(path, 'not json');
    expect((await failure(readDescriptor(path))).code).toBe(
      'INVALID_DESCRIPTOR',
    );
  });

  it('refuses a descriptor whose endpoint is not the loopback', async () => {
    const path = await descriptor({
      version: 2,
      endpoint: 'http://example.com:4545',
      browserKey: key,
    });
    expect((await failure(readDescriptor(path))).code).toBe('INVALID_OPTIONS');
  });
});

describe('endpoints', () => {
  it('accepts the loopback with a port, normalized to 127.0.0.1', () => {
    expect(parseEndpoint('http://localhost:4545/').origin).toBe(
      'http://127.0.0.1:4545',
    );
  });

  it.each([
    'https://127.0.0.1:4545',
    'http://192.168.1.2:4545',
    'http://127.0.0.1',
    'http://user:pass@127.0.0.1:4545',
    'http://127.0.0.1:4545/browser',
    'not a url',
  ])('rejects %s', (value) => {
    expect(() => parseEndpoint(value)).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTIONS' }),
    );
  });
});

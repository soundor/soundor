import { open } from 'node:fs/promises';

import { PROTOCOL_VERSION } from '@soundor/devtools-protocol';
import { z } from 'zod';

import { DriverError } from './errors';

/** The environment variable naming the session descriptor (as for plugins). */
export const DESCRIPTOR_ENV = 'SOUNDOR_DEVTOOLS_SESSION';
/** The environment variable holding a browser key for `endpoint` connections. */
export const BROWSER_KEY_ENV = 'SOUNDOR_DEVTOOLS_BROWSER_KEY';

const MAX_DESCRIPTOR_BYTES = 65536;

/** Where a DevTools session listens and the key a control client signs in with. */
export interface SessionCredentials {
  /** `http://127.0.0.1:<port>`. */
  endpoint: URL;
  browserKey: string;
}

const browserKeySchema = z.string().regex(/^[0-9a-f]{64}$/);
// The descriptor also holds the native runtime's token: it is never read.
const descriptorSchema = z.object({
  version: z.literal(PROTOCOL_VERSION),
  endpoint: z.string(),
  browserKey: browserKeySchema,
});

/**
 * A DevTools endpoint: the server binds the IPv4 loopback only, so anything
 * else would at best fail and at worst send the key to another host.
 */
export function parseEndpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DriverError(
      'INVALID_OPTIONS',
      `Invalid DevTools endpoint "${value}": expected http://127.0.0.1:<port>`,
    );
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    !url.port ||
    url.username ||
    url.password ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search ||
    url.hash
  )
    throw new DriverError(
      'INVALID_OPTIONS',
      `Invalid DevTools endpoint "${url.origin}": DevTools serves only http://127.0.0.1:<port> (or localhost)`,
    );
  // The server listens on 127.0.0.1, which it also trusts as Host and Origin.
  return new URL(`http://127.0.0.1:${url.port}`);
}

export function parseBrowserKey(value: string): string {
  if (!browserKeySchema.safeParse(value).success)
    throw new DriverError(
      'INVALID_OPTIONS',
      'The browser key is malformed: use the browserKey of the session descriptor',
    );
  return value;
}

/**
 * Reads a protected session descriptor, refusing one other users could read:
 * DevTools writes it with mode 0600 in a private directory.
 */
export async function readDescriptor(
  path: string,
): Promise<SessionCredentials> {
  let text: string;
  try {
    const file = await open(path, 'r');
    try {
      const stats = await file.stat();
      if (!stats.isFile() || stats.size > MAX_DESCRIPTOR_BYTES)
        throw new DriverError(
          'INVALID_DESCRIPTOR',
          `${path} is not a Soundor DevTools session descriptor`,
        );
      if (process.platform !== 'win32' && (stats.mode & 0o077) !== 0)
        throw new DriverError(
          'INVALID_DESCRIPTOR',
          `${path} can be read by other users (mode ${(stats.mode & 0o777).toString(8)}); a DevTools descriptor must be private (0600)`,
        );
      text = await file.readFile('utf8');
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error instanceof DriverError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    throw new DriverError(
      'INVALID_DESCRIPTOR',
      code === 'ENOENT'
        ? `No DevTools session descriptor at ${path}: the session ended, or soundor dev prints another path`
        : `Cannot read the DevTools session descriptor at ${path} (${code ?? 'unknown error'})`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  // Report no field values: the descriptor holds secrets.
  const parsed = descriptorSchema.safeParse(value);
  if (!parsed.success)
    throw new DriverError(
      'INVALID_DESCRIPTOR',
      `${path} is not a Soundor DevTools session descriptor (protocol version ${PROTOCOL_VERSION})`,
    );
  return {
    endpoint: parseEndpoint(parsed.data.endpoint),
    browserKey: parsed.data.browserKey,
  };
}

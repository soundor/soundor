import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import type { FastifyRequest } from 'fastify';

export function secret(): string {
  return randomBytes(32).toString('hex');
}
export function matches(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const bytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    bytes.length === expectedBytes.length &&
    timingSafeEqual(bytes, expectedBytes)
  );
}

export function createAuthentication(
  developmentOrigin: string | undefined,
  getPort: () => number,
) {
  if (developmentOrigin) {
    const origin = new URL(developmentOrigin);
    if (
      origin.protocol !== 'http:' ||
      !['localhost', '127.0.0.1'].includes(origin.hostname) ||
      origin.origin !== developmentOrigin
    )
      throw new Error(
        'developmentOrigin must be an exact HTTP loopback origin',
      );
  }
  const sessionId = randomUUID();
  const token = secret();
  const browserToken = secret();
  const browserKey = secret();
  const browserTickets = new Map<string, number>();
  const cookieName = `soundor_${sessionId.replaceAll('-', '')}`;
  const origins = (): string[] => [
    `http://localhost:${getPort()}`,
    `http://127.0.0.1:${getPort()}`,
    ...(developmentOrigin ? [developmentOrigin] : []),
  ];
  function trustedHost(request: FastifyRequest): boolean {
    return [`localhost:${getPort()}`, `127.0.0.1:${getPort()}`].includes(
      request.headers.host ?? '',
    );
  }
  function trustedOrigin(request: FastifyRequest): boolean {
    return (
      typeof request.headers.origin === 'string' &&
      origins().includes(request.headers.origin)
    );
  }
  function authenticatedBrowser(request: FastifyRequest): boolean {
    return matches(request.cookies[cookieName], browserToken);
  }

  return {
    sessionId,
    token,
    browserKey,
    browserToken,
    cookieName,
    trustedHost,
    trustedOrigin,
    authenticatedBrowser,
    consumeBrowserKey(key: string | undefined) {
      const expires = key ? browserTickets.get(key) : undefined;
      if (!matches(key, browserKey) && !(expires && expires > Date.now()))
        return false;
      if (key) browserTickets.delete(key);
      return true;
    },
    createTicket() {
      const key = secret();
      if (browserTickets.size >= 32)
        browserTickets.delete(browserTickets.keys().next().value!);
      browserTickets.set(key, Date.now() + 60000);
      return key;
    },
    expireTickets(now: number) {
      for (const [key, expires] of browserTickets)
        if (expires <= now) browserTickets.delete(key);
    },
    clear() {
      browserTickets.clear();
    },
  };
}
export type Authentication = ReturnType<typeof createAuthentication>;

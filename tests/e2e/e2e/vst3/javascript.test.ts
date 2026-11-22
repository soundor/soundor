// The UI's JavaScript runtime: the language and the Web globals, checked
// inside it (src/web-apis/checks.ts), then fetch() through the system's HTTP
// client and soundor:storage, which outlive an instance.
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import { launchPlugin } from '@soundor/vitest-e2e';
import { afterEach, expect, test } from 'vitest';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** An HTTP server on localhost answering POSTs with what they sent. */
async function echoServer(): Promise<string> {
  const server = createServer((request, response) => {
    void body(request).then((text) => {
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          echo: {
            method: request.method,
            type: request.headers['content-type'],
            body: JSON.parse(text) as unknown,
          },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/echo`;
}

test('the language and the Web globals work as the checks expect', async () => {
  const plugin = await launchPlugin();

  await expect(plugin.getByDebugId('checks')).toHaveText(
    /^JavaScript: (\d+) of \1 passed$/,
    { timeout: 10_000 },
  );
});

test('fetch() sends a request and reads the JSON answer', async () => {
  const url = await echoServer();
  const plugin = await launchPlugin();

  await plugin.getByRole('textinput', { name: 'URL' }).type(url);
  await plugin.getByRole('button', { name: 'Fetch' }).click();

  await expect(plugin.getByDebugId('fetch.result')).toHaveText(
    'Fetched 201: {"method":"POST","type":"application/json","body":{"from":"soundor-e2e"}}',
    { timeout: 10_000 },
  );
});

test('a value stored by one instance is there for the next', async () => {
  const value = `run ${crypto.randomUUID()}`;
  const first = await launchPlugin();
  await expect(first.getByDebugId('storage.value')).toHaveText(/^Stored: /);

  await first.getByRole('textinput', { name: 'Value to store' }).type(value);
  await first.getByRole('button', { name: 'Store' }).click();
  await expect(first.getByDebugId('storage.value')).toHaveText(
    `Stored: ${value}`,
  );
  await first.close();

  const second = await launchPlugin();
  await expect(second.getByDebugId('storage.value')).toHaveText(
    `Stored: ${value}`,
  );
});

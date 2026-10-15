import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { channel } from 'node:diagnostics_channel';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = new URL('../../../../../../', import.meta.url);
const serverRequire = createRequire(
  new URL('packages/devtools-server/package.json', repository),
);
const configRequire = createRequire(
  new URL('packages/config/package.json', repository),
);
const { rolldown } = await import(
  pathToFileURL(configRequire.resolve('rolldown')).href
);
const { WebSocket } = await import(
  pathToFileURL(join(dirname(serverRequire.resolve('ws')), 'wrapper.mjs')).href
);
// Record paths and statuses only, never session credentials or payloads.
const requests = [];
channel('http.server.request.start').subscribe(({ request, response }) => {
  requests.push(
    `${request.method} ${request.url}: started (length=${request.headers['content-length'] ?? 'none'})`,
  );
  response.once('finish', () => {
    requests.push(`${request.method} ${request.url}: ${response.statusCode}`);
  });
});
const serverDependencies = new Set(
  Object.keys(
    JSON.parse(
      await readFile(
        new URL('packages/devtools-server/package.json', repository),
        'utf8',
      ),
    ).dependencies,
  ),
);
const root = await mkdtemp(join(tmpdir(), 'soundor-native-debug-'));
const bundle = await rolldown({
  input: fileURLToPath(
    new URL('packages/devtools-server/src/server.ts', repository),
  ),
  platform: 'node',
  plugins: [
    {
      name: 'test-dependencies',
      resolveId(source) {
        // Keep production dependencies external. Bundling CommonJS plugins
        // can turn their require('ws') into require('file://...'), which Node
        // cannot resolve. Native tests exercise the installed dependencies.
        if (
          source !== '@soundor/devtools-protocol' &&
          serverDependencies.has(source)
        )
          return {
            id: pathToFileURL(
              source === 'ws'
                ? join(dirname(serverRequire.resolve('ws')), 'wrapper.mjs')
                : serverRequire.resolve(source),
            ).href,
            external: true,
          };
        if (source === '@soundor/devtools-protocol')
          return fileURLToPath(
            new URL('packages/devtools-protocol/src/index.ts', repository),
          );
      },
    },
  ],
});
await bundle.write({ file: join(root, 'server.mjs'), format: 'esm' });
await bundle.close();
const { startDevToolsServer } = await import(
  pathToFileURL(join(root, 'server.mjs')).href
);
const staticDir = fileURLToPath(
  new URL('packages/devtools-client/dist', repository),
);
let server = await startDevToolsServer({
  projectRoot: root,
  port: 0,
  staticDir,
});
const descriptorPath = server.descriptorPath;
const processTarget = spawn(process.argv[2], [], {
  env: { ...process.env, SOUNDOR_DEVTOOLS_SESSION: descriptorPath },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
let errors = '';
processTarget.stdout.on('data', (data) => {
  output += data.toString();
});
processTarget.stderr.on('data', (data) => {
  errors += data.toString();
});
const finished = new Promise((resolve, reject) => {
  processTarget.once('error', reject);
  processTarget.once('exit', (code, signal) =>
    code === 0
      ? resolve()
      : reject(
          new Error(`Native target failed (${code}, ${signal}): ${errors}`),
        ),
  );
});
// Mark handled immediately; the final await still observes native failures.
void finished.catch(() => {});
let phase = 'browser connection';
let socket;
let messages = [];
async function until(predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Timed out during ${phase}. Native output: ${output}\n${errors}\nHTTP: ${requests.join(', ')}`,
  );
}
async function take(predicate) {
  await until(() => messages.some(predicate));
  return messages.splice(messages.findIndex(predicate), 1)[0];
}
async function connect() {
  messages = [];
  const { browserKey } = JSON.parse(
    await readFile(server.descriptorPath, 'utf8'),
  );
  const response = await fetch(server.connection.endpoint + '/browser/auth', {
    method: 'POST',
    headers: { Origin: server.url, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: browserKey }),
  });
  assert.equal(response.status, 200);
  socket = new WebSocket(
    server.connection.endpoint.replace('http', 'ws') + '/browser',
    {
      origin: server.url,
      headers: { Cookie: response.headers.get('set-cookie').split(';')[0] },
    },
  );
  socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  await take((message) => message.type === 'hello');
  socket.send(JSON.stringify({ type: 'hello', version: 1 }));
}
async function request(method, targetId, params = {}) {
  phase = method;
  const id = crypto.randomUUID();
  socket.send(
    JSON.stringify({ type: 'request', id, targetId, method, params }),
  );
  return take((message) => message.type === 'response' && message.id === id);
}
try {
  if (process.env.SOUNDOR_PLAYWRIGHT_MODULE) {
    const { inspectInBrowser } = await import('./BrowserInspector.mjs');
    await inspectInBrowser(server, () => output);
    await finished;
  } else {
    await connect();
    phase = 'native registration';
    const changed = await take(
      (message) =>
        message.event === 'Runtime.targetsChanged' && message.data.length > 0,
    );
    const target = changed.data[0];
    assert.equal(target.name, 'Native Bridge Test');
    const tree = await request('UI.getTree', target.id);
    assert.equal(tree.result.nodes.length, 4);
    const control = tree.result.nodes.find((node) => node.ref.id === '3');
    const details = await request('UI.getNode', target.id, {
      node: control.ref,
    });
    assert.equal(details.result.accessibility.name, 'Gain');
    assert.equal(details.result.accessibility.value.now, 0.5);
    assert.equal(details.result.bounds.width, 40);
    const animations = await request('Animation.getActive', target.id);
    assert.equal(animations.result[0].kind, 'timing');
    assert.equal(animations.result[0].targets[0].node.id, '3');
    await request('Control.acquire', target.id);
    await request('Diagnostics.setRecording', target.id, { enabled: true });
    await request('UI.highlightNode', target.id, { node: control.ref });
    await until(() => output.includes('generation=1 highlight=3'));
    const metrics = await request('Diagnostics.getMetrics', target.id);
    assert.equal(metrics.result.recording, true);
    assert.ok(metrics.result.frameCount > 0);
    assert.equal(metrics.result.frames[0].mode, 'cpu');
    await request('Events.subscribe', target.id, {
      events: ['UI.nodeSelected', 'Runtime.generationChanged'],
    });
    await request('UI.setPickerEnabled', target.id, { enabled: true });
    const selected = await take(
      (message) => message.event === 'UI.nodeSelected',
    );
    assert.deepEqual(selected.data.node, { generation: 1, id: '4' });
    await until(() => output.includes('PICKED applicationEvents=0'));
    await request('UI.setPickerEnabled', target.id, { enabled: true });
    await take(
      (message) =>
        message.event === 'Runtime.targetsChanged' &&
        message.data.some((info) => info.generation === 2),
    );
    assert.equal(
      (await request('UI.getNode', target.id, { node: control.ref })).error
        .code,
      'STALE_NODE',
    );
    await request('UI.highlightNode', target.id, {
      node: { generation: 2, id: '3' },
    });
    await until(() => output.includes('generation=2 highlight=3'));
    const port = Number(new URL(server.url).port);
    await server.close();
    socket.terminate();
    await until(() => output.includes('generation=2 highlight=0'));
    // Explicit protected descriptor handoff designates a new session, without
    // port discovery. The bridge checks that its project association is unchanged.
    server = await startDevToolsServer({
      projectRoot: root,
      port,
      staticDir,
    });
    await mkdir(dirname(descriptorPath), { recursive: true, mode: 0o700 });
    await writeFile(descriptorPath, await readFile(server.descriptorPath), {
      mode: 0o600,
    });
    await connect();
    const reconnect = await take(
      (message) =>
        message.event === 'Runtime.targetsChanged' && message.data.length > 0,
    );
    assert.notEqual(reconnect.data[0].id, target.id);
    assert.equal(
      (await request('UI.getTree', reconnect.data[0].id)).result.generation,
      2,
    );
    await finished;
    console.log(
      'PASS: real native tree/details, highlight, picker event isolation, reload, disconnect, designated-session reconnection, clean teardown',
    );
  }
} finally {
  socket?.terminate();
  await server.close();
  processTarget.kill();
  await finished.catch(() => {});
  await rm(root, { recursive: true, force: true });
  await rm(dirname(descriptorPath), { recursive: true, force: true });
}

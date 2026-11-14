// The Rust processor in Chromium's AudioWorklet, as the Web host runs it:
// the fixture crate compiled to wasm32-unknown-unknown, loaded by
// createProcessorNode (bundled as the host bundles it) into an
// OfflineAudioContext, whose rendered audio is compared sample for sample.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Page } from '@playwright/test';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildFixture, channels, contract, parameters } from './fixture/build';

/** What the page's `render` takes. */
interface Render {
  readonly gain: number;
  readonly inputs: readonly number[];
  readonly outputs: readonly number[];
  readonly frames: number;
  readonly contract?: typeof contract;
  /** At this time, post the gain, or the host's tempo. */
  readonly change?: {
    readonly at: number;
    readonly gain?: number;
    readonly tempo?: number;
  };
  /** The host's tempo, posted before the processor exists. */
  readonly early?: number;
}

/** What it gives back. */
interface Rendered {
  readonly ready: true | string;
  readonly output: number[][];
  readonly published: number[][];
  readonly channels: [number, number | number[]][][];
  readonly errors: string[];
}

const PAGE = `<!doctype html>
<script type="module">
  import { createProcessorNode } from './node.js';
  const RATE = 48000;
  window.render = async (options) => {
    const wasm = await (await fetch('./fixture.wasm')).arrayBuffer();
    const outputs = options.outputs.reduce((sum, count) => sum + count, 0);
    const context = new OfflineAudioContext({
      numberOfChannels: Math.max(1, outputs),
      length: options.frames,
      sampleRate: RATE,
    });
    const result = { published: [], channels: [], errors: [] };
    const processor = await createProcessorNode(context, {
      wasm,
      contract: options.contract,
      inputs: options.inputs,
      outputs: options.outputs,
      channels: options.channels,
      parameters: options.parameters,
      maxFrames: 128,
      onPublished: (values) => result.published.push([...values]),
      onChannels: (changes) =>
        result.channels.push(
          changes.map(([index, value]) => [
            index,
            typeof value === 'number' ? value : [...value],
          ]),
        ),
      onError: (message) => result.errors.push(message),
    });
    if (options.early !== undefined)
      processor.setTransport([options.early, 0, Number.NaN, 1, 0]);
    // A ramp, reversed on the right.
    const input = context.createBuffer(Math.max(1, options.inputs[0] ?? 1), options.frames, RATE);
    for (let channel = 0; channel < input.numberOfChannels; channel++) {
      const data = input.getChannelData(channel);
      for (let i = 0; i < data.length; i++)
        data[i] = (channel === 0 ? i : data.length - i) / data.length - 0.5;
    }
    const source = context.createBufferSource();
    source.buffer = input;
    source.connect(processor.node);
    processor.node.connect(context.destination);
    source.start();
    if (options.change !== undefined)
      // Offline rendering outruns messages: they are posted while it waits.
      context.suspend(options.change.at).then(async () => {
        await processor.ready.catch(() => {});
        if (options.change.parameters !== undefined)
          processor.setParameters(options.change.parameters);
        if (options.change.tempo !== undefined)
          processor.setTransport([options.change.tempo, 0, Number.NaN, 1, 0]);
        // The message reaches the rendering thread before rendering goes on.
        await new Promise((resolve) => setTimeout(resolve, 50));
        await context.resume();
      });
    // An offline context makes the processor when it starts rendering.
    const rendered = await context.startRendering();
    result.ready = await processor.ready.then(
      () => true,
      (error) => error.message,
    );
    // What the worklet posted from the last blocks.
    await new Promise((resolve) => setTimeout(resolve, 100));
    result.output = [];
    for (let channel = 0; channel < rendered.numberOfChannels; channel++)
      result.output.push([...rendered.getChannelData(channel)]);
    processor.dispose();
    return result;
  };
  window.loaded = true;
</script>
`;

let server: Server;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  const wasm = buildFixture();
  const bundled = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: true,
      lib: {
        entry: fileURLToPath(new URL('./node.ts', import.meta.url)),
        formats: ['es'],
        fileName: 'node',
      },
    },
  });
  const outputs = Array.isArray(bundled)
    ? bundled[0]!.output
    : 'output' in bundled
      ? bundled.output
      : [];
  const [code] = outputs.flatMap((output) =>
    'code' in output ? [output.code] : [],
  );
  if (code === undefined) throw new Error('Vite bundled no node.js');
  const files: Record<string, [string, string | Uint8Array]> = {
    '/': ['text/html', PAGE],
    '/node.js': ['text/javascript', code],
    '/fixture.wasm': ['application/wasm', wasm],
  };
  server = createServer((request, response) => {
    const file = files[request.url ?? ''];
    if (file === undefined) return void response.writeHead(404).end();
    response.writeHead(200, { 'content-type': file[0] }).end(file[1]);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch();
  page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
  );
  await page.waitForFunction(() => 'loaded' in window);
  if (errors.length > 0)
    throw new Error(`The page failed: ${errors.join('\n')}`);
});

afterAll(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

async function render(options: Render): Promise<Rendered> {
  return page.evaluate(
    (settings) =>
      (
        window as unknown as { render(options: unknown): Promise<Rendered> }
      ).render(settings),
    {
      ...options,
      contract: options.contract ?? contract,
      channels,
      parameters: parameters(options.gain),
      change:
        options.change === undefined
          ? undefined
          : {
              ...options.change,
              parameters:
                options.change.gain === undefined
                  ? undefined
                  : parameters(options.change.gain),
            },
    },
  );
}

/** The page's input ramp, as Float32Array holds it. */
function ramp(frames: number, channel: number): number[] {
  return Array.from({ length: frames }, (_, i) =>
    Math.fround((channel === 0 ? i : frames - i) / frames - 0.5),
  );
}
const times = (samples: number[], gain: number) =>
  samples.map((sample) => Math.fround(sample * gain));

describe('the Rust processor in an AudioWorklet', () => {
  it('applies the gain to stereo, sample for sample', async () => {
    const frames = 48_000;
    const result = await render({
      gain: 0.5,
      inputs: [2, 0],
      outputs: [2],
      frames,
    });
    expect(result.ready).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.output[0]).toEqual(times(ramp(frames, 0), 0.5));
    expect(result.output[1]).toEqual(times(ramp(frames, 1), 0.5));
  });

  it('processes mono', async () => {
    const frames = 4800;
    const result = await render({
      gain: 0.25,
      inputs: [1, 0],
      outputs: [1],
      frames,
    });
    expect(result.ready).toBe(true);
    expect(result.output).toEqual([times(ramp(frames, 0), 0.25)]);
  });

  it('follows parameters posted while it runs', async () => {
    const frames = 9600;
    // 0.1 s: a render quantum's boundary, frame 4864.
    const at = 4864 / 48_000;
    const result = await render({
      gain: 1,
      inputs: [1, 0],
      outputs: [1],
      frames,
      change: { at, gain: 0.5 },
    });
    const input = ramp(frames, 0);
    expect(result.output[0]!.slice(0, 4864)).toEqual(input.slice(0, 4864));
    expect(result.output[0]!.slice(4864)).toEqual(
      times(input.slice(4864), 0.5),
    );
  });

  it('posts what the processing publishes: read-only parameters and channels', async () => {
    const result = await render({
      gain: 0.75,
      inputs: [2, 0],
      outputs: [2],
      frames: 4800,
      // The first render quantum's end, before the first channels go.
      change: { at: 128 / 48_000, tempo: 96 },
    });
    expect(result.published.length).toBeGreaterThan(0);
    // The fixture's peak: the block's peak, in dB.
    for (const [peak] of result.published) {
      expect(peak).toBeGreaterThanOrEqual(-96);
      expect(peak).toBeLessThanOrEqual(20 * Math.log10(0.75 * 0.5) + 1e-6);
    }
    // About 60 times a second: 4800 frames at 48 kHz are 0.1 s.
    expect(result.channels.length).toBeGreaterThanOrEqual(5);
    expect(result.channels.length).toBeLessThanOrEqual(7);
    // history: the gain and the host's tempo; level: the block's peak.
    for (const changes of result.channels) {
      expect(changes.map(([index]) => index)).toEqual([0, 1]);
      expect(changes[0]![1]).toEqual([0.75, 96]);
    }
    const last = result.channels.at(-1)![1]![1] as number;
    expect(last).toBeGreaterThan(0);
    expect(last).toBeLessThanOrEqual(0.75 * 0.5);
  });

  it('keeps what is posted before the processor exists', async () => {
    const result = await render({
      gain: 0.5,
      inputs: [1, 0],
      outputs: [1],
      frames: 4800,
      early: 140,
      // Waits for it to arrive, then goes on.
      change: { at: 128 / 48_000 },
    });
    expect(result.channels.length).toBeGreaterThan(0);
    for (const changes of result.channels)
      expect(changes[0]![1]).toEqual([0.5, 140]);
  });

  it('is silent after a panic, and says so once', async () => {
    const result = await render({
      gain: 2,
      inputs: [1, 0],
      outputs: [1],
      frames: 4800,
    });
    expect(result.ready).toBe(true);
    expect(result.errors).toEqual([
      'The audio processor panicked; it is silent until the audio restarts',
    ]);
    expect(result.output[0]!.every((sample) => sample === 0)).toBe(true);
  });

  it('refuses a module built from another config, and stays silent', async () => {
    const result = await render({
      gain: 0.5,
      inputs: [2, 0],
      outputs: [2],
      frames: 4800,
      contract: { ...contract, channels: 3 },
    });
    expect(result.ready).toMatch(/another soundor.config/);
    expect(result.errors).toEqual([
      expect.stringMatching(/another soundor.config/),
    ]);
    expect(result.output.flat().every((sample) => sample === 0)).toBe(true);
  });
});

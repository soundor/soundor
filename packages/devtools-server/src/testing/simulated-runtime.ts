import { setTimeout as wait } from 'node:timers/promises';

import {
  PROTOCOL_VERSION,
  eventPayloads,
  type NodeRef,
  runtimeCommandSchema,
  runtimeEventSchema,
  responseSchema,
  type DebugNode,
  type DebugAnimation,
  type DebugMetrics,
  type DebugTree,
  type RuntimeCommand,
  type EventName,
  type DebugMethod,
  methodParams,
} from '@soundor/devtools-protocol';

import type { DevToolsConnection } from '../server';
import { originalNodes } from './fixtures';

export interface SimulatedRuntimeOptions {
  connection: DevToolsConnection;
  name?: string;
  diagnostics?: boolean;
  /** Seed diagnostics and a deterministic startup log for interactive development. */
  sampleData?: boolean;
}
export async function startSimulatedRuntime(options: SimulatedRuntimeOptions) {
  const { connection } = options;
  const name = options.name ?? 'Gain Plugin';
  const diagnostics = options.diagnostics ?? true;
  const headers = {
    Authorization: `Bearer ${connection.token}`,
    'X-Soundor-Session': connection.sessionId,
    'Content-Type': 'application/json',
  };
  const register = await fetch(connection.endpoint + '/runtime/register', {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(3000),
    body: JSON.stringify({
      version: PROTOCOL_VERSION,
      sessionId: connection.sessionId,
      generation: 1,
      name,
      runtime: 'Simulated Soundor',
      capabilities: diagnostics
        ? ['inspector', 'accessibility', 'animations', 'performance']
        : ['inspector', 'accessibility'],
    }),
  });
  if (!register.ok) throw new Error('Simulated runtime registration failed');
  const registration = (await register.json()) as {
    targetId: string;
    targetToken: string;
  };
  const targetHeaders = {
    ...headers,
    'X-Soundor-Target': registration.targetId,
    'X-Soundor-Target-Token': registration.targetToken,
  };
  let alive = true;
  let generation = 1;
  let treeNodes = structuredClone(originalNodes);
  const methods: string[] = [];
  const commands: RuntimeCommand[] = [];
  const errors = new Map<string, string>();
  let treeRequests = 0;
  const delays = new Map<DebugMethod, number>();
  let metrics: DebugMetrics = {
    generation: 1,
    recording: false,
    elapsedMs: 0,
    frameCount: 0,
    delayedTicks: 0,
    tickIntervalMs: 0,
    phases: {},
    frames: [],
  };
  let animations: DebugAnimation[] = [
    {
      id: '1',
      playbackGeneration: 0,
      state: 'running',
      kind: 'timing',
      elapsedMs: 50,
      durationMs: 100,
      durationScope: 'iteration',
      delayMs: 0,
      iterations: 1,
      easing: 'linear',
      targets: [
        {
          node: { generation: 1, id: '3' },
          properties: ['opacity'],
          presentation: { opacity: 0.5 },
        },
      ],
      targetsTruncated: false,
    },
  ];
  let pickerEnabled = false;
  let selection: NodeRef | null = null;
  let highlighted: { generation: number; id: string } | null = null;
  if (options.sampleData) {
    metrics = {
      ...metrics,
      elapsedMs: 100,
      frameCount: 6,
      tickIntervalMs: 16.5,
      phases: { layoutMs: 0.5, ticks: 6 },
      frames: [
        {
          timestampMs: 100,
          frameMs: 4,
          layoutMs: 0.5,
          mode: 'cpu',
          backend: 'Simulated Skia',
        },
      ],
    };
  }
  const abort = new AbortController();
  let failure: unknown;
  const operations = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >();
  async function post(
    message: unknown,
    operationSignal?: AbortSignal,
  ): Promise<void> {
    const event = runtimeEventSchema.safeParse(message);
    const response = await fetch(connection.endpoint + '/runtime/messages', {
      method: 'POST',
      headers: targetHeaders,
      signal: AbortSignal.any([
        abort.signal,
        AbortSignal.timeout(3000),
        ...(operationSignal ? [operationSignal] : []),
      ]),
      body: JSON.stringify(
        event.success ? event.data : responseSchema.parse(message),
      ),
    });
    // Consume bodies so repeated event publication can reuse its connection.
    await response.arrayBuffer();
    // A cancellation may beat a response already in transit.
    if (!response.ok && response.status !== 409)
      throw new Error('Runtime message rejected: ' + response.status);
  }
  async function execute(
    command: Extract<RuntimeCommand, { type: 'request' }>,
    signal: AbortSignal,
  ): Promise<void> {
    const delay = delays.get(command.method) ?? 0;
    if (delay) await wait(delay, undefined, { signal });
    if (signal.aborted || !alive || command.generation !== generation) return;
    const injected = errors.get(command.method);
    if (injected !== undefined) {
      await post(
        {
          type: 'response',
          id: command.id,
          error: { code: 'STALE_NODE', message: injected },
        },
        signal,
      );
      return;
    }
    let result: unknown = null;
    let error: string | undefined;
    if (command.method === 'Diagnostics.getMetrics') result = metrics;
    if (command.method === 'Diagnostics.setRecording') {
      metrics = {
        ...metrics,
        recording: methodParams['Diagnostics.setRecording'].parse(
          command.params,
        ).enabled,
      };
      await post({
        type: 'event',
        event: 'Diagnostics.metrics',
        data: metrics,
      });
    }
    if (command.method === 'Animation.getActive') {
      const filter = methodParams['Animation.getActive'].parse(
        command.params,
      ).node;
      result = animations.filter(
        (animation) =>
          !filter ||
          animation.targets.some((target) => target.node.id === filter.id),
      );
    }
    if (command.method === 'UI.getTree') {
      ++treeRequests;
      result = {
        generation,
        revision: treeRequests,
        roots: treeNodes
          .filter((node) => node.parent === null)
          .map((node) => node.ref.id),
        nodes: treeNodes,
        truncated: false,
      } satisfies DebugTree;
    }
    if (command.method === 'UI.getNode') {
      const ref = methodParams['UI.getNode'].parse(command.params).node;
      result = treeNodes.find((item) => item.ref.id === ref.id);
      if (!result) error = 'Node was removed';
    }
    if (command.method === 'UI.highlightNode') {
      const { node } = methodParams['UI.highlightNode'].parse(command.params);
      if (!treeNodes.some((item) => item.ref.id === node.id))
        error = 'Node was removed';
      else highlighted = node;
    }
    if (command.method === 'UI.clearHighlight') highlighted = null;
    for (const [method, field] of [
      ['UI.getLayout', 'layout'],
      ['UI.getStyles', 'styles'],
      ['UI.getAccessibility', 'accessibility'],
    ] as const) {
      if (command.method === method) {
        const ref = methodParams[method].parse(command.params).node;
        const node = treeNodes.find((node) => node.ref.id === ref.id);
        if (!node) error = 'Node was removed';
        else result = node[field] ?? {};
      }
    }
    if (command.method === 'UI.setPickerEnabled') {
      pickerEnabled = methodParams['UI.setPickerEnabled'].parse(
        command.params,
      ).enabled;
      await post({
        type: 'event',
        event: 'UI.pickerChanged',
        data: command.params,
      });
    }

    if (signal.aborted || !alive || command.generation !== generation) return;
    await post(
      {
        type: 'response',
        id: command.id,
        ...(error
          ? { error: { code: 'STALE_NODE', message: error } }
          : { result }),
      },
      signal,
    );
  }
  const poller = (async () => {
    while (alive) {
      try {
        const response = await fetch(connection.endpoint + '/runtime/poll', {
          headers: targetHeaders,
          signal: abort.signal,
        });
        if (!response.ok)
          throw new Error('Runtime poll rejected: ' + response.status);
        const batch = (await response.json()) as { commands: unknown[] };
        for (const value of batch.commands) {
          if (!alive) break;
          const command = runtimeCommandSchema.parse(value);
          commands.push(command);
          if (command.type === 'cancel') {
            operations.get(command.id)?.controller.abort();
          } else if (command.type === 'resetControl') {
            pickerEnabled = false;
            highlighted = null;
            metrics = {
              ...metrics,
              generation,
              recording: false,
              frameCount: 0,
              frames: [],
              phases: {},
            };
            if (diagnostics)
              await post({
                type: 'event',
                event: 'Diagnostics.metrics',
                data: metrics,
              });
          } else if (command.type === 'subscribe') {
            if (
              options.sampleData &&
              command.events.includes('Console.message')
            )
              await post({
                type: 'event',
                event: 'Console.message',
                data: {
                  level: 'info',
                  source: name,
                  message: 'Simulated runtime ready',
                  timestamp: 1000,
                },
              });
          } else if (command.type === 'request') {
            methods.push(command.method);
            const controller = new AbortController();
            const done = execute(command, controller.signal)
              .catch((error: unknown) => {
                if (alive && !controller.signal.aborted) {
                  failure = error;
                  abort.abort();
                }
              })
              .finally(() => operations.delete(command.id));
            operations.set(command.id, { controller, done });
          }
        }
      } catch (error) {
        if (alive && !abort.signal.aborted) failure = error;
        break;
      }
    }
  })();
  let closed: Promise<void> | undefined;
  function close(): Promise<void> {
    return (closed ??= (async () => {
      alive = false;
      abort.abort();
      for (const operation of operations.values()) operation.controller.abort();
      try {
        await fetch(connection.endpoint + '/runtime/disconnect', {
          method: 'POST',
          headers: targetHeaders,
          signal: AbortSignal.timeout(2000),
        });
      } catch {
        /* Server may already have closed. */
      }
      abort.abort();
      await poller;
      await Promise.all(
        [...operations.values()].map((operation) => operation.done),
      );
    })());
  }
  return {
    id: registration.targetId,
    close,
    get selection() {
      return selection;
    },
    get pickerEnabled() {
      return pickerEnabled;
    },
    get highlighted() {
      return highlighted;
    },
    get generation() {
      return generation;
    },
    get failure() {
      return failure;
    },
    methods,
    commands,
    errors,
    get treeRequests() {
      return treeRequests;
    },
    get pendingRequests() {
      return operations.size;
    },
    delayNode() {
      delays.set('UI.getNode', 180);
    },
    /** Delay before a command reads or changes state; useful for cancellation tests. */
    setCommandDelay(method: DebugMethod, milliseconds: number) {
      if (!Number.isFinite(milliseconds) || milliseconds < 0)
        throw new Error('Invalid command delay');
      delays.set(method, milliseconds);
    },
    setNodes(value: DebugNode[]) {
      treeNodes = value;
    },
    setAnimations(value: DebugAnimation[]) {
      animations = value;
    },
    async setMetrics(value: DebugMetrics) {
      metrics = value;
      await post({
        type: 'event',
        event: 'Diagnostics.metrics',
        data: metrics,
      });
    },
    async event(event: EventName, data: unknown) {
      // Validate before mutating state, just as the server validates transport.
      eventPayloads[event].parse(data);
      if (event === 'UI.nodeSelected') {
        selection = eventPayloads['UI.nodeSelected'].parse(data).node;
        pickerEnabled = false;
      }
      if (event === 'UI.pickerChanged')
        pickerEnabled = eventPayloads['UI.pickerChanged'].parse(data).enabled;
      await post({ type: 'event', event, data });
    },
    async reload() {
      ++generation;
      for (const operation of operations.values()) operation.controller.abort();
      selection = null;
      pickerEnabled = false;
      highlighted = null;
      metrics = {
        ...metrics,
        generation,
        recording: false,
        frameCount: 0,
        frames: [],
        phases: {},
      };
      animations = animations.map((animation) => ({
        ...animation,
        targets: animation.targets.map((target) => ({
          ...target,
          node: { ...target.node, generation },
        })),
      }));
      treeNodes = treeNodes.map((item) => ({
        ...item,
        ref: { ...item.ref, generation },
      }));
      await post({
        type: 'event',
        event: 'Runtime.generationChanged',
        data: { generation },
      });
    },
    disconnect: close,
  };
}

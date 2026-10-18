import { z } from 'zod';

export const PROTOCOL_VERSION = 2;
export const helloSchema = z.strictObject({
  type: z.literal('hello'),
  version: z.literal(PROTOCOL_VERSION),
});
export const MAX_MESSAGE_BYTES = 1024 * 1024;
export const MAX_NODES = 5000;
/**
 * Captures travel apart from messages, as binary HTTP: a runtime uploads at
 * most this many PNG bytes per capture, and a session keeps at most
 * MAX_CAPTURES of them, each for CAPTURE_TTL_MS.
 */
export const MAX_CAPTURE_BYTES = 32 * 1024 * 1024;
export const MAX_CAPTURES = 8;
export const CAPTURE_TTL_MS = 60_000;
/** At most this many pixels a side, and in all, per capture. */
export const MAX_CAPTURE_SIDE = 8192;
export const MAX_CAPTURE_PIXELS = 16 * 1024 * 1024;
const identifier = z.string().min(1).max(128);
const text = z.string().max(16384);
export const capabilitySchema = z.enum([
  'inspector',
  'accessibility',
  'animations',
  'performance',
  // Synthetic pointer and keyboard input through the engine's own dispatch.
  // Never implied by `inspector`.
  'input',
  // PNG captures of the rendered view (Capture.screenshot).
  'capture',
]);
export type Capability = z.infer<typeof capabilitySchema>;
export const nodeRefSchema = z.strictObject({
  generation: z.number().int().positive(),
  id: identifier,
});
export type NodeRef = z.infer<typeof nodeRefSchema>;
const boundsSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite(),
  height: z.number().finite(),
});
// Values are protocol data, never native objects. Bounds on transport size also
// bound extensible property objects; producers must omit unsupported values.
const properties = z.record(z.string().max(128), z.json());
export const nodeSchema = z.strictObject({
  ref: nodeRefSchema,
  type: identifier,
  parent: identifier.nullable(),
  children: z.array(identifier).max(MAX_NODES),
  text: text.optional(),
  debugId: identifier.optional(),
  bounds: boundsSchema,
  properties: properties.optional(),
  layout: properties.optional(),
  styles: properties.optional(),
  presentation: properties.optional(),
  accessibility: properties.optional(),
  focused: z.boolean(),
  visible: z.boolean(),
});
export type DebugNode = z.infer<typeof nodeSchema>;
export const treeSchema = z.strictObject({
  generation: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  roots: z.array(identifier).max(16),
  nodes: z.array(nodeSchema).max(MAX_NODES),
  truncated: z.boolean(),
});
export type DebugTree = z.infer<typeof treeSchema>;
export const targetSchema = z.strictObject({
  id: identifier,
  name: identifier,
  runtime: identifier,
  generation: z.number().int().positive(),
  capabilities: z.array(capabilitySchema).max(8),
  processId: z.number().int().positive().optional(),
});
export type DebugTarget = z.infer<typeof targetSchema>;
export const registrationSchema = targetSchema
  .omit({ id: true })
  .extend({ version: z.literal(PROTOCOL_VERSION), sessionId: identifier });

export const eventNameSchema = z.enum([
  'UI.treeChanged',
  'UI.nodeSelected',
  'UI.pickerChanged',
  'Runtime.generationChanged',
  'Console.message',
  'Animation.changed',
  'Diagnostics.metrics',
]);
export type EventName = z.infer<typeof eventNameSchema>;
const empty = z.strictObject({});
const coordinate = z.number().finite().min(-1e6).max(1e6);
/** Modifier keys held for an input, besides those held with Input.dispatchKey. */
export const modifierSchema = z.enum(['Shift', 'Control', 'Alt', 'Meta']);
export type Modifier = z.infer<typeof modifierSchema>;
const modifiers = z.array(modifierSchema).max(4).optional();
/**
 * Pointer input in the view's logical pixels. `click` is a move, a press and
 * a release at the point, dispatched together; `cancel` ends the synthetic
 * pointer without a click. `down`, `up` and `cancel` default to the last
 * position.
 */
export const pointerInputSchema = z
  .strictObject({
    action: z.enum(['move', 'down', 'up', 'click', 'cancel']),
    x: coordinate.optional(),
    y: coordinate.optional(),
    button: z.enum(['left', 'middle', 'right']).optional(),
    modifiers,
  })
  .refine(
    (input) =>
      (input.x === undefined) === (input.y === undefined) &&
      (!['move', 'click'].includes(input.action) || input.x !== undefined),
    'move and click need x and y; give both or neither',
  );
export type PointerInput = z.infer<typeof pointerInputSchema>;
export const methodParams = {
  'Runtime.getTargets': empty,
  'Events.subscribe': z.strictObject({
    events: z.array(eventNameSchema).max(7),
  }),
  'UI.getTree': empty,
  'UI.getNode': z.strictObject({ node: nodeRefSchema }),
  'UI.getLayout': z.strictObject({ node: nodeRefSchema }),
  'UI.getStyles': z.strictObject({ node: nodeRefSchema }),
  'UI.getAccessibility': z.strictObject({ node: nodeRefSchema }),
  'UI.highlightNode': z.strictObject({ node: nodeRefSchema }),
  'UI.clearHighlight': empty,
  'UI.setPickerEnabled': z.strictObject({ enabled: z.boolean() }),
  'UI.hitTest': z.strictObject({ x: coordinate, y: coordinate }),
  'Input.dispatchPointer': pointerInputSchema,
  'Input.dispatchWheel': z.strictObject({
    x: coordinate,
    y: coordinate,
    deltaX: coordinate,
    deltaY: coordinate,
    modifiers,
  }),
  // KeyboardEvent.key values: "a", "A", "Enter", "ArrowLeft", "Shift"…
  'Input.dispatchKey': z.strictObject({
    action: z.enum(['down', 'up', 'press']),
    key: z.string().min(1).max(32),
    modifiers,
  }),
  'Input.typeText': z.strictObject({ text: z.string().min(1).max(1024) }),
  'Input.focus': z.strictObject({ node: nodeRefSchema }),
  // The whole view, or the part a node covers.
  'Capture.screenshot': z.strictObject({ node: nodeRefSchema.optional() }),
  'Animation.getActive': z.strictObject({ node: nodeRefSchema.optional() }),
  'Diagnostics.getMetrics': empty,
  'Diagnostics.setRecording': z.strictObject({ enabled: z.boolean() }),
} as const;
export type DebugMethod = keyof typeof methodParams;
export type Params<M extends DebugMethod> = z.infer<(typeof methodParams)[M]>;
/** Typed client request; the transport schema validates the same method map. */
export type Request<M extends DebugMethod> = {
  type: 'request';
  id: string;
  targetId?: string;
  method: M;
  params: Params<M>;
};
export const methodSchema = z.enum(
  Object.keys(methodParams) as [DebugMethod, ...DebugMethod[]],
);
export const requestSchema = z
  .strictObject({
    type: z.literal('request'),
    id: identifier,
    targetId: identifier.optional(),
    method: methodSchema,
    params: z.unknown(),
  })
  .superRefine((request, ctx) => {
    const parsed = methodParams[request.method].safeParse(request.params);
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        ctx.addIssue({
          code: 'custom',
          path: ['params', ...issue.path],
          message: issue.message,
        });
    if (request.method !== 'Runtime.getTargets' && !request.targetId)
      ctx.addIssue({
        code: 'custom',
        path: ['targetId'],
        message: 'Target required',
      });
  });
export type DebugRequest = z.infer<typeof requestSchema>;
export const errorSchema = z.strictObject({
  code: z.enum([
    'INVALID_REQUEST',
    'UNAUTHORIZED',
    'PROTOCOL_MISMATCH',
    'TARGET_GONE',
    'STALE_NODE',
    'MISSING_CAPABILITY',
    'TIMEOUT',
    'CANCELLED',
    'BUSY',
    // The node cannot take this input (not focusable, not connected).
    'NOT_ACTIONABLE',
    // The instance cannot capture its view now (nothing rendered, too big).
    'CAPTURE_UNAVAILABLE',
    'INTERNAL',
  ]),
  message: text,
});
export type DebugError = z.infer<typeof errorSchema>;
export const responseSchema = z
  .strictObject({
    type: z.literal('response'),
    id: identifier,
    targetId: identifier.optional(),
    result: z.json().optional(),
    error: errorSchema.optional(),
  })
  .refine(
    (value) => (value.result !== undefined) !== (value.error !== undefined),
    'Exactly one of result or error required',
  );
export type DebugResponse = z.infer<typeof responseSchema>;
export const cancelSchema = z.strictObject({
  type: z.literal('cancel'),
  id: identifier,
});

export const animationStateSchema = z.enum([
  'running',
  'paused',
  'finished',
  'cancelled',
]);
export const animationChangeSchema = z.strictObject({
  id: identifier,
  playbackGeneration: z.number().int().nonnegative(),
  node: nodeRefSchema,
  state: animationStateSchema,
});
export const animationSchema = z.strictObject({
  id: identifier,
  playbackGeneration: z.number().int().nonnegative(),
  state: animationStateSchema,
  kind: z.enum(['timing', 'spring', 'keyframes', 'composition']),
  elapsedMs: z.number().finite().nonnegative(),
  durationMs: z.number().finite().nonnegative().nullable(),
  durationScope: z.enum(['iteration', 'program']),
  delayMs: z.number().finite().nonnegative(),
  iterations: z.number().finite().nonnegative().nullable(),
  easing: identifier.optional(),
  spring: properties.optional(),
  keyframeCount: z.number().int().nonnegative().optional(),
  targets: z
    .array(
      z.strictObject({
        node: nodeRefSchema,
        properties: z.array(identifier).max(9),
        presentation: properties,
      }),
    )
    .max(64),
  targetsTruncated: z.boolean(),
  snapshotTruncated: z.boolean().optional(),
});
export type DebugAnimation = z.infer<typeof animationSchema>;
export type AnimationChange = z.infer<typeof animationChangeSchema>;
export const frameMetricsSchema = z.strictObject({
  timestampMs: z.number().finite().nonnegative(),
  frameMs: z.number().finite().nonnegative().optional(),
  productionMs: z.number().finite().nonnegative().optional(),
  compositionMs: z.number().finite().nonnegative().optional(),
  rasterMs: z.number().finite().nonnegative().optional(),
  layoutMs: z.number().finite().nonnegative().optional(),
  mode: z.enum(['cpu', 'gpu']).optional(),
  backend: text.optional(),
  layerCount: z.number().int().nonnegative().optional(),
  layersRasterized: z.number().int().nonnegative().optional(),
  pixelsRasterized: z.number().nonnegative().optional(),
  gpuLayers: z.number().int().nonnegative().optional(),
  gpuReadbacks: z.number().int().nonnegative().optional(),
  cachedRasterBytes: z.number().nonnegative().optional(),
  layersComposited: z.number().int().nonnegative().optional(),
  pixelsComposited: z.number().nonnegative().optional(),
  bytesUploaded: z.number().nonnegative().optional(),
  textureAllocations: z.number().int().nonnegative().optional(),
  drawCalls: z.number().int().nonnegative().optional(),
  compositorReadbacks: z.number().int().nonnegative().optional(),
});
export const metricsSchema = z.strictObject({
  generation: z.number().int().positive(),
  recording: z.boolean(),
  elapsedMs: z.number().finite().nonnegative(),
  frameCount: z.number().int().nonnegative(),
  delayedTicks: z.number().int().nonnegative().optional(),
  tickDelayThresholdMs: z.number().finite().positive().optional(),
  tickIntervalMs: z.number().finite().nonnegative().optional(),
  phases: properties,
  frames: z.array(frameMetricsSchema).max(300),
});
export type DebugMetrics = z.infer<typeof metricsSchema>;

export const eventPayloads = {
  'UI.treeChanged': z.strictObject({
    generation: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    kind: z.enum(['structure', 'properties']).optional(),
    nodes: z.array(nodeSchema).max(128).optional(),
    metadataIncomplete: z.boolean().optional(),
  }),
  'UI.nodeSelected': z.strictObject({ node: nodeRefSchema }),
  'UI.pickerChanged': z.strictObject({ enabled: z.boolean() }),
  'Runtime.generationChanged': z.strictObject({
    generation: z.number().int().positive(),
  }),
  'Console.message': z.strictObject({
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: text,
    source: identifier,
    timestamp: z.number().finite(),
  }),
  'Animation.changed': z.strictObject({
    generation: z.number().int().positive(),
    changes: z.array(animationChangeSchema).max(128),
    truncated: z.boolean(),
  }),
  'Diagnostics.metrics': metricsSchema,
} as const;
export const runtimeEventSchema = z
  .strictObject({
    type: z.literal('event'),
    event: eventNameSchema,
    data: z.unknown(),
    // An event about one client's own state (its picker): the server sends
    // it to that client alone, without this field.
    client: identifier.optional(),
  })
  .superRefine((event, ctx) => {
    if (!eventPayloads[event.event].safeParse(event.data).success)
      ctx.addIssue({ code: 'custom', message: 'Invalid event payload' });
  });
export type RuntimeEvent = z.infer<typeof runtimeEventSchema>;
export type ServerMessage =
  | DebugResponse
  | {
      type: 'hello';
      version: typeof PROTOCOL_VERSION;
      sessionId: string;
      clientId: string;
      project: string;
    }
  | { type: 'error'; error: DebugError }
  | { type: 'event'; event: 'Runtime.targetsChanged'; data: DebugTarget[] }
  | (Omit<RuntimeEvent, 'client'> & { targetId?: string; scope?: 'session' });
/**
 * What the server sends a runtime. Requests name the client that made them:
 * a runtime keeps each client's debug state apart (its synthetic pointer and
 * keys, highlight and picker) and drops it on `clientGone`.
 */
export type RuntimeCommand =
  | (DebugRequest & { generation: number; client: string })
  | { type: 'cancel'; id: string }
  | { type: 'subscribe'; events: EventName[] }
  | { type: 'clientGone'; client: string };
export const runtimeCommandSchema = z.union([
  requestSchema.safeExtend({
    generation: z.number().int().positive(),
    client: identifier,
  }),
  cancelSchema,
  z.strictObject({
    type: z.literal('subscribe'),
    events: z.array(eventNameSchema).max(7),
  }),
  z.strictObject({ type: z.literal('clientGone'), client: identifier }),
]);
export interface MethodResults {
  'Runtime.getTargets': DebugTarget[];
  'Events.subscribe': null;
  'UI.getTree': DebugTree;
  'UI.getNode': DebugNode;
  'UI.getLayout': Record<string, unknown>;
  'UI.getStyles': Record<string, unknown>;
  'UI.getAccessibility': Record<string, unknown>;
  'UI.highlightNode': null;
  'UI.clearHighlight': null;
  'UI.setPickerEnabled': null;
  'UI.hitTest': HitTest;
  'Input.dispatchPointer': InputResult;
  'Input.dispatchWheel': InputResult;
  'Input.dispatchKey': InputResult;
  'Input.typeText': InputResult;
  'Input.focus': null;
  'Capture.screenshot': Screenshot;
  'Animation.getActive': DebugAnimation[];
  'Diagnostics.getMetrics': DebugMetrics;
  'Diagnostics.setRecording': null;
}
export type Response<M extends DebugMethod> = {
  type: 'response';
  id: string;
  targetId?: string;
} & (
  | { result: MethodResults[M]; error?: never }
  | { result?: never; error: DebugError }
);

/** The deepest node at a point, and its ancestors from a root: what input there reaches. */
export const hitTestSchema = z.strictObject({
  node: nodeRefSchema.nullable(),
  path: z.array(identifier).max(512),
});
export type HitTest = z.infer<typeof hitTestSchema>;
/** What the input reached: whether the UI handled it, and its target. */
export const inputResultSchema = z.strictObject({
  handled: z.boolean(),
  node: nodeRefSchema.nullable(),
});
export type InputResult = z.infer<typeof inputResultSchema>;

const captureSize = {
  width: z.number().int().positive().max(MAX_CAPTURE_SIDE),
  height: z.number().int().positive().max(MAX_CAPTURE_SIDE),
  /** Device pixels per logical pixel. */
  scale: z.number().finite().positive().max(16),
  format: z.literal('png'),
  bytes: z.number().int().positive().max(MAX_CAPTURE_BYTES),
};
/** What a runtime answers Capture.screenshot with, after uploading the PNG. */
export const runtimeCaptureSchema = z.strictObject(captureSize);
/**
 * What a client gets: a capture the server keeps for CAPTURE_TTL_MS, read
 * with its session cookie at `GET /browser/captures/<id>`.
 */
export const screenshotSchema = z.strictObject({
  id: identifier,
  ...captureSize,
});
export type Screenshot = z.infer<typeof screenshotSchema>;

export const methodResults = {
  'Runtime.getTargets': z.array(targetSchema).max(64),
  'Events.subscribe': z.null(),
  'UI.getTree': treeSchema,
  'UI.getNode': nodeSchema,
  'UI.getLayout': properties,
  'UI.getStyles': properties,
  'UI.getAccessibility': properties,
  'UI.highlightNode': z.null(),
  'UI.clearHighlight': z.null(),
  'UI.setPickerEnabled': z.null(),
  'UI.hitTest': hitTestSchema,
  'Input.dispatchPointer': inputResultSchema,
  'Input.dispatchWheel': inputResultSchema,
  'Input.dispatchKey': inputResultSchema,
  'Input.typeText': inputResultSchema,
  'Input.focus': z.null(),
  'Capture.screenshot': screenshotSchema,
  'Animation.getActive': z.array(animationSchema).max(256),
  'Diagnostics.getMetrics': metricsSchema,
  'Diagnostics.setRecording': z.null(),
} as const;

export function methodCapability(method: DebugMethod): Capability | undefined {
  if (method === 'UI.getAccessibility') return 'accessibility';
  if (method.startsWith('UI.')) return 'inspector';
  if (method.startsWith('Input.')) return 'input';
  if (method.startsWith('Capture.')) return 'capture';
  if (method.startsWith('Animation.')) return 'animations';
  if (method.startsWith('Diagnostics.')) return 'performance';
  return undefined;
}

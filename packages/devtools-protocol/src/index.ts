import { z } from 'zod';

export const PROTOCOL_VERSION = 1;
export const helloSchema = z.strictObject({
  type: z.literal('hello'),
  version: z.literal(PROTOCOL_VERSION),
});
export const MAX_MESSAGE_BYTES = 1024 * 1024;
export const MAX_NODES = 5000;
const identifier = z.string().min(1).max(128);
const text = z.string().max(16384);
export const capabilitySchema = z.enum([
  'inspector',
  'accessibility',
  'animations',
  'performance',
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
  capabilities: z.array(capabilitySchema).max(4),
  controller: identifier.nullable(),
  processId: z.number().int().positive().optional(),
});
export type DebugTarget = z.infer<typeof targetSchema>;
export const registrationSchema = targetSchema
  .omit({ id: true, controller: true })
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
export const methodParams = {
  'Runtime.getTargets': empty,
  'Control.acquire': empty,
  'Control.release': empty,
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
    'LEASE_BUSY',
    'LEASE_REQUIRED',
    'TIMEOUT',
    'CANCELLED',
    'BUSY',
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

export const eventPayloads = {
  'UI.treeChanged': z.strictObject({
    generation: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
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
  }),
  'Diagnostics.metrics': properties,
} as const;
export const runtimeEventSchema = z
  .strictObject({
    type: z.literal('event'),
    event: eventNameSchema,
    data: z.unknown(),
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
  | (RuntimeEvent & { targetId?: string; scope?: 'session' });
export type RuntimeCommand =
  | DebugRequest
  | { type: 'cancel'; id: string }
  | { type: 'subscribe'; events: EventName[] }
  | { type: 'resetControl' };
export interface MethodResults {
  'Runtime.getTargets': DebugTarget[];
  'Control.acquire': { controller: string };
  'Control.release': null;
  'Events.subscribe': null;
  'UI.getTree': DebugTree;
  'UI.getNode': DebugNode;
  'UI.getLayout': Record<string, unknown>;
  'UI.getStyles': Record<string, unknown>;
  'UI.getAccessibility': Record<string, unknown>;
  'UI.highlightNode': null;
  'UI.clearHighlight': null;
  'UI.setPickerEnabled': null;
  'Animation.getActive': Record<string, unknown>[];
  'Diagnostics.getMetrics': Record<string, unknown>;
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

export const methodResults = {
  'Runtime.getTargets': z.array(targetSchema).max(64),
  'Control.acquire': z.strictObject({ controller: identifier }),
  'Control.release': z.null(),
  'Events.subscribe': z.null(),
  'UI.getTree': treeSchema,
  'UI.getNode': nodeSchema,
  'UI.getLayout': properties,
  'UI.getStyles': properties,
  'UI.getAccessibility': properties,
  'UI.highlightNode': z.null(),
  'UI.clearHighlight': z.null(),
  'UI.setPickerEnabled': z.null(),
  'Animation.getActive': z.array(properties).max(MAX_NODES),
  'Diagnostics.getMetrics': properties,
  'Diagnostics.setRecording': z.null(),
} as const;

export function methodCapability(method: DebugMethod): Capability | undefined {
  if (method === 'UI.getAccessibility') return 'accessibility';
  if (method.startsWith('UI.')) return 'inspector';
  if (method.startsWith('Animation.')) return 'animations';
  if (method.startsWith('Diagnostics.')) return 'performance';
  return undefined;
}
export function requiresControl(method: DebugMethod): boolean {
  return [
    'UI.highlightNode',
    'UI.clearHighlight',
    'UI.setPickerEnabled',
    'Diagnostics.setRecording',
  ].includes(method);
}

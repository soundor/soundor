import {
  describeNativeApi,
  describeState,
  environmentIssues,
} from '@soundor/core';
import { z } from 'zod';

import { audioSchema, checkAudio } from './audio';
import { checkEditor, editorSchema, resolveEditor } from './editor';
import { type ConfigIssue, ConfigError } from './errors';
import { resolveParameters } from './parameter-model';
import type { ResolvedParameter } from './parameters';
import type { Runtime } from './runtime';
import { checkSigningIdentity } from './signing';
import type { ResolvedSoundorConfig, SoundorConfig } from './types';
import { CONFIG_VERSION } from './version';

/** The lifecycle methods every {@link Runtime} must expose. */
const RUNTIME_METHODS = ['init', 'gen', 'dev', 'build', 'doctor'] as const;

/**
 * Structural check that a value is a live {@link Runtime}: a `string` id plus
 * the five lifecycle methods. Runtimes are registered by passing the object a
 * runtime factory returns (e.g. `juceRuntime({ ... })`) into `runtimes[]`.
 */
function isRuntime(value: unknown): value is Runtime {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record['id'] !== 'string') return false;
  return RUNTIME_METHODS.every(
    (method) => typeof record[method] === 'function',
  );
}

// Not strict: a runtime factory makes this object, and a newer one may carry
// more than this copy knows.
const runtimeSchema = z.object({
  id: z.string(),
  options: z.record(z.string(), z.unknown()).optional(),
  runtime: z.custom<Runtime>(isRuntime, {
    message:
      'missing runtime implementation; register it with a runtime factory, e.g. `runtimes: [juceRuntime({ ... })]`, not a bare `{ id }`',
  }),
});

const text = z.string().trim().min(1);
const pluginSchema = z.strictObject({
  kind: z.enum(['effect', 'instrument', 'midiEffect']).optional(),
  categories: z
    .array(
      z.enum([
        'eq',
        'dynamics',
        'delay',
        'reverb',
        'modulation',
        'distortion',
        'filter',
        'utility',
        'analyzer',
        'synth',
        'sampler',
        'generator',
      ]),
    )
    .optional(),
  vendor: z
    .strictObject({
      name: text,
      website: z.url().optional(),
      supportEmail: z.email().optional(),
    })
    .optional(),
  copyright: text.optional(),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$(?![\s\S])/, 'expected a version such as 1.2.0')
    .default('0.1.0'),
  id: z
    .string()
    .regex(
      /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/,
      'expected a reverse-DNS identifier such as com.acme.reverb (letters, digits, hyphens and dots)',
    ),
  name: z.string().trim().min(1, 'expected a non-empty display name'),
});

// The native API's structure is checked by describeNativeApi, which reports
// precise paths; zod only guarantees it is an object here.
const nativeSchema = z.strictObject({
  types: z.record(z.string(), z.unknown()).optional(),
  methods: z.record(z.string(), z.unknown()).optional(),
  events: z.record(z.string(), z.unknown()).optional(),
  channels: z.record(z.string(), z.unknown()).optional(),
});

const signingIdentitySchema = z.string().superRefine((value, ctx) => {
  const problem = checkSigningIdentity(value);
  if (problem !== undefined) ctx.addIssue({ code: 'custom', message: problem });
});

const signingSchema = z.strictObject({
  macos: z
    .strictObject({ identity: signingIdentitySchema.optional() })
    .optional(),
});

const soundorConfigSchema = z.strictObject({
  plugin: pluginSchema,
  audio: audioSchema.optional(),
  parameterGroups: z
    .record(
      z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
      z.strictObject({ label: text }),
    )
    .optional(),
  env: z
    .record(z.string(), z.union([z.string(), z.boolean(), z.number()]))
    .optional(),
  editor: editorSchema.optional(),
  runtimes: z.array(runtimeSchema),
  // Checked by resolveParameters, which reports each problem precisely.
  parameters: z.unknown().optional(),
  native: nativeSchema.optional(),
  state: z.unknown().optional(),
  signing: signingSchema.optional(),
});

/**
 * A property this schema does not have is an error, never dropped: it may be
 * a typo, or a setting of a newer config schema that this host, and so its
 * runtimes, would otherwise silently ignore.
 */
function unknownPropertyMessage(key: string): string {
  return `unknown property '${key}' in @soundor/config ${CONFIG_VERSION}; check its spelling, or upgrade soundor and @soundor/config together if it is from a newer release`;
}

/** Renders a zod path array into a `parameters[0].max`-style string. */
function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else out += out === '' ? String(segment) : `.${String(segment)}`;
  }
  return out;
}

/**
 * Validates and normalizes a raw, evaluated config value into a deterministic
 * {@link ResolvedSoundorConfig}. Throws {@link ConfigError} of kind `validation` with
 * structured issues on any failure.
 */
export function validateConfig(raw: unknown): ResolvedSoundorConfig {
  const result = soundorConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues: ConfigIssue[] = result.error.issues.flatMap((issue) =>
      issue.code === 'unrecognized_keys'
        ? issue.keys.map((key) => ({
            path: formatPath([...issue.path, key]),
            message: unknownPropertyMessage(key),
          }))
        : [{ path: formatPath(issue.path), message: issue.message }],
    );
    // Parameters are checked apart from the shape: report theirs too.
    if (typeof raw === 'object' && raw !== null)
      resolveParameters(
        (raw as { parameters?: unknown }).parameters,
        'parameters',
        issues,
        unknownPropertyMessage,
      );
    throw new ConfigError('validation', 'Invalid Soundor config.', issues);
  }

  const data = result.data;
  const issues: ConfigIssue[] = [];

  if (data.env) issues.push(...environmentIssues(data.env));

  checkUniqueIds(data.runtimes, (r) => r.id, 'runtimes', 'runtime', issues);
  const parameters = resolveParameters(
    data.parameters,
    'parameters',
    issues,
    unknownPropertyMessage,
  );
  if (data.editor !== undefined) checkEditor(data.editor, 'editor', issues);
  if (data.audio) checkAudio(data.audio, issues);
  let bypass: string | undefined;
  for (const parameter of parameters) {
    if (
      parameter.group !== undefined &&
      !Object.hasOwn(data.parameterGroups ?? {}, parameter.group)
    )
      issues.push({
        path: `parameters.${parameter.id}.group`,
        message: 'must name a declared parameter group',
      });
    if (parameter.role === 'bypass') {
      if (bypass !== undefined)
        issues.push({
          path: `parameters.${parameter.id}.role`,
          message: `bypass is already assigned to '${bypass}'`,
        });
      bypass = parameter.id;
      if (parameter.type !== 'boolean' || parameter.access === 'readOnly')
        issues.push({
          path: `parameters.${parameter.id}.role`,
          message: 'bypass must be a writable boolean parameter',
        });
    }
  }
  const native = describeNativeApi(data.native as SoundorConfig['native']);
  if (!native.ok) issues.push(...native.issues);
  try {
    describeState(
      data.state as SoundorConfig['state'],
      data.native as SoundorConfig['native'],
    );
  } catch (error) {
    issues.push({ path: 'state', message: String(error) });
  }

  if (issues.length > 0) {
    throw new ConfigError('validation', 'Invalid Soundor config.', issues);
  }

  return normalize(data, parameters);
}

function checkUniqueIds<T>(
  items: readonly T[],
  getId: (item: T) => string,
  arrayName: string,
  label: string,
  issues: ConfigIssue[],
): void {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    const id = getId(item);
    if (seen.has(id)) {
      issues.push({
        path: `${arrayName}[${i}].id`,
        message: `duplicate ${label} id '${id}'; every ${label} id must be unique`,
      });
    }
    seen.add(id);
  });
}

/** Builds a canonical config so identical input always yields identical output. */
function normalize(
  data: z.infer<typeof soundorConfigSchema>,
  parameters: ResolvedParameter[],
): ResolvedSoundorConfig {
  return {
    plugin: {
      ...structuredClone(data.plugin),
      id: data.plugin.id,
      name: data.plugin.name.trim(),
      version: data.plugin.version,
    },
    ...(data.audio === undefined ? {} : { audio: structuredClone(data.audio) }),
    ...(data.parameterGroups === undefined
      ? {}
      : { parameterGroups: structuredClone(data.parameterGroups) }),
    ...(data.env === undefined ? {} : { env: structuredClone(data.env) }),
    editor: { ...resolveEditor(data.editor) },
    runtimes: data.runtimes.map((runtime) => ({
      id: runtime.id,
      options: runtime.options ?? {},
      runtime: runtime.runtime,
    })),
    parameters,
    state: structuredClone(data.state ?? {}) as ResolvedSoundorConfig['state'],
    // Validated above; a structured clone detaches it from the user's object.
    native: structuredClone(
      data.native ?? {},
    ) as ResolvedSoundorConfig['native'],
    signing:
      data.signing?.macos?.identity !== undefined
        ? { macos: { identity: data.signing.macos.identity.trim() } }
        : {},
  };
}

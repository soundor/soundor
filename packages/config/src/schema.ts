import { z } from 'zod';

import { type ConfigIssue, ConfigError } from './errors';
import type { Parameter, SoundorConfig } from './types';

const baseParameter = {
  id: z.string(),
  label: z.string(),
  onChange: z.string().optional(),
};

const floatParameterSchema = z.object({
  type: z.literal('float'),
  ...baseParameter,
  min: z.number(),
  max: z.number(),
  default: z.number(),
  unit: z.string().optional(),
});

const intParameterSchema = z.object({
  type: z.literal('int'),
  ...baseParameter,
  min: z.number(),
  max: z.number(),
  default: z.number(),
  unit: z.string().optional(),
});

const boolParameterSchema = z.object({
  type: z.literal('bool'),
  ...baseParameter,
  default: z.boolean(),
});

const enumParameterSchema = z.object({
  type: z.literal('enum'),
  ...baseParameter,
  values: z.array(z.string()),
  default: z.string(),
});

const parameterSchema = z.discriminatedUnion('type', [
  floatParameterSchema,
  intParameterSchema,
  boolParameterSchema,
  enumParameterSchema,
]);

const runtimeSchema = z.object({
  id: z.string(),
  options: z.record(z.string(), z.unknown()).optional(),
});

const nativeMethodSchema = z.object({
  name: z.string(),
  input: z.string(),
  output: z.string(),
});

const soundorConfigSchema = z.object({
  runtimes: z.array(runtimeSchema),
  parameters: z.array(parameterSchema),
  nativeMethods: z.array(nativeMethodSchema).optional(),
});

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
 * {@link SoundorConfig}. Throws {@link ConfigError} of kind `validation` with
 * structured issues on any failure.
 */
export function validateConfig(raw: unknown): SoundorConfig {
  const result = soundorConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues: ConfigIssue[] = result.error.issues.map((issue) => ({
      path: formatPath(issue.path),
      message: issue.message,
    }));
    throw new ConfigError('validation', 'Invalid Soundor config.', issues);
  }

  const data = result.data;
  const issues: ConfigIssue[] = [];

  checkUniqueIds(data.runtimes, (r) => r.id, 'runtimes', 'runtime', issues);
  checkUniqueIds(
    data.parameters,
    (p) => p.id,
    'parameters',
    'parameter',
    issues,
  );
  data.parameters.forEach((parameter, i) => {
    checkParameter(parameter, `parameters[${i}]`, issues);
  });

  if (issues.length > 0) {
    throw new ConfigError('validation', 'Invalid Soundor config.', issues);
  }

  return normalize(data);
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

function checkParameter(
  parameter: Parameter,
  path: string,
  issues: ConfigIssue[],
): void {
  switch (parameter.type) {
    case 'float':
    case 'int': {
      const { min, max, default: value } = parameter;
      if (min > max) {
        issues.push({
          path: `${path}.min`,
          message: `min (${min}) must be <= max (${max}); swap the bounds`,
        });
      }
      if (value < min || value > max) {
        issues.push({
          path: `${path}.default`,
          message: `default (${value}) is out of range; set it within [${min}, ${max}]`,
        });
      }
      break;
    }
    case 'enum': {
      if (parameter.values.length === 0) {
        issues.push({
          path: `${path}.values`,
          message: 'enum must declare at least one value',
        });
      } else if (!parameter.values.includes(parameter.default)) {
        issues.push({
          path: `${path}.default`,
          message: `default '${parameter.default}' is not one of the declared values [${parameter.values.join(', ')}]`,
        });
      }
      break;
    }
    case 'bool':
      break;
  }
}

/** Builds a canonical config so identical input always yields identical output. */
function normalize(data: z.infer<typeof soundorConfigSchema>): SoundorConfig {
  return {
    runtimes: data.runtimes.map((runtime) => ({
      id: runtime.id,
      options: runtime.options ?? {},
    })),
    parameters: data.parameters.map(normalizeParameter),
    nativeMethods: (data.nativeMethods ?? []).map((method) => ({
      name: method.name,
      input: method.input,
      output: method.output,
    })),
  };
}

function normalizeParameter(parameter: Parameter): Parameter {
  switch (parameter.type) {
    case 'float':
    case 'int':
      return {
        type: parameter.type,
        id: parameter.id,
        label: parameter.label,
        min: parameter.min,
        max: parameter.max,
        default: parameter.default,
        ...(parameter.unit !== undefined ? { unit: parameter.unit } : {}),
        ...(parameter.onChange !== undefined
          ? { onChange: parameter.onChange }
          : {}),
      };
    case 'bool':
      return {
        type: 'bool',
        id: parameter.id,
        label: parameter.label,
        default: parameter.default,
        ...(parameter.onChange !== undefined
          ? { onChange: parameter.onChange }
          : {}),
      };
    case 'enum':
      return {
        type: 'enum',
        id: parameter.id,
        label: parameter.label,
        values: [...parameter.values],
        default: parameter.default,
        ...(parameter.onChange !== undefined
          ? { onChange: parameter.onChange }
          : {}),
      };
  }
}

import {
  describeState,
  record,
  stateValue,
  stateJson,
  type StateDeclarations,
  type NativeApiDeclaration,
} from '@soundor/core';
import { compileJsFunction } from '@soundor/expression/compiler/js';

import type { ConfigIssue } from './errors';
import { semanticsInputs, type ResolvedParameter } from './parameters';

/** A factory snapshot. Omitted writable parameters and state fields use their config defaults. */
export interface FactoryPresetDeclaration {
  /** Stable identity, independent of the display name and program index. */
  id: string;
  /** Name shown by host program selectors and the plugin UI. */
  name: string;
  /** Plain-unit parameter values; read-only processing outputs cannot be preset. */
  parameters?: Readonly<Record<string, number | boolean | string>>;
  /** Declared persistent application values. */
  state?: Readonly<Record<string, unknown>>;
}

/** Complete, detached, validated factory snapshot. */
export interface ResolvedFactoryPreset {
  readonly id: string;
  readonly name: string;
  readonly parameters: Readonly<Record<string, number | boolean | string>>;
  readonly state: Readonly<Record<string, unknown>>;
}

export function resolvePresets(
  raw: unknown,
  parameters: readonly ResolvedParameter[],
  state: StateDeclarations | undefined,
  native: NativeApiDeclaration | undefined,
  issues: ConfigIssue[],
): ResolvedFactoryPreset[] {
  if (raw === undefined) return [];
  const fail = (path: string, message: string) =>
    issues.push({ path, message });
  if (!Array.isArray(raw)) {
    fail('presets', 'expected an array of factory presets');
    return [];
  }
  const schema = describeState(state, native);
  const ids = new Set<string>();
  return raw.flatMap((value: unknown, index) => {
    const path = `presets[${index}]`;
    if (!record(value)) {
      fail(path, 'expected a factory preset object');
      return [];
    }
    for (const key of Object.keys(value))
      if (!['id', 'name', 'parameters', 'state'].includes(key))
        fail(`${path}.${key}`, 'unknown preset property');
    if (
      typeof value.id !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_-]*$/.test(value.id)
    ) {
      fail(`${path}.id`, 'expected a stable preset identifier');
      return [];
    }
    if (ids.has(value.id)) fail(`${path}.id`, 'duplicate factory preset id');
    ids.add(value.id);
    if (typeof value.name !== 'string' || !value.name.trim()) {
      fail(`${path}.name`, 'expected a nonempty preset name');
      return [];
    }
    if (
      (value.parameters !== undefined && !record(value.parameters)) ||
      (value.state !== undefined && !record(value.state))
    ) {
      fail(path, 'parameters and state must be objects');
      return [];
    }
    const supplied = value.parameters as Record<string, unknown> | undefined;
    const fields = value.state as Record<string, unknown> | undefined;
    const values: Record<string, number | boolean | string> = {};
    for (const key of Object.keys(supplied ?? {})) {
      const parameter = parameters.find((p) => p.id === key);
      if (!parameter || parameter.access === 'readOnly')
        fail(
          `${path}.parameters.${key}`,
          'expected a declared writable parameter',
        );
    }
    for (const p of parameters.filter((p) => p.access !== 'readOnly')) {
      const v =
        supplied && Object.hasOwn(supplied, p.id) ? supplied[p.id] : p.default;
      const valid =
        p.type === 'boolean'
          ? typeof v === 'boolean'
          : p.type === 'choice'
            ? p.options.some((o) => o.value === v)
            : typeof v === 'number' &&
              Number.isFinite(v) &&
              v >= p.min &&
              v <= p.max &&
              (p.type === 'float32' || Number.isInteger(v));
      if (!valid) {
        fail(`${path}.parameters.${p.id}`, 'invalid preset parameter value');
        continue;
      }
      if (typeof v === 'number') {
        const constrained = compileJsFunction(
          p.semantics.constrain,
          semanticsInputs(p.semantics.valueType).constrain,
        )(v) as number;
        const canonical = p.type === 'float32' ? Math.fround(v) : v;
        if (constrained !== canonical) {
          fail(
            `${path}.parameters.${p.id}`,
            'preset parameter value must lie on its declared step grid',
          );
          continue;
        }
        values[p.id] = canonical;
      } else values[p.id] = v as boolean | string;
    }
    for (const key of Object.keys(fields ?? {}))
      if (!schema.fields.some((f) => f.name === key))
        fail(`${path}.state.${key}`, 'unknown persistent state field');
    const persistent: Record<string, unknown> = {};
    for (const field of schema.fields) {
      try {
        persistent[field.name] = stateValue(
          schema,
          field.type,
          fields && Object.hasOwn(fields, field.name)
            ? fields[field.name]
            : field.default,
          `${path}.state.${field.name}`,
        );
      } catch (error) {
        fail(`${path}.state.${field.name}`, String(error));
      }
    }
    try {
      stateJson({ version: 1, parameters: values, state: persistent });
    } catch (error) {
      fail(path, String(error));
    }
    return [
      {
        id: value.id,
        name: value.name.trim(),
        parameters: values,
        state: persistent,
      },
    ];
  });
}

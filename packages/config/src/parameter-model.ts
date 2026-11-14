/**
 * Validates a config's parameter declarations and resolves each into a
 * {@link ResolvedParameter}: what it is, and what it does as expressions.
 *
 * Every rule of a parameter's behavior is written here once — mappings,
 * snapping to the step, the default text — as expressions that every
 * runtime compiles, so a JUCE plugin and its Web version agree by
 * construction. Runtimes never re-implement a mapping.
 */

import {
  INTEGERS,
  checkExpression,
  createContext,
  expressions as e,
  substituteInputs,
  type Expression,
  type ExpressionInputs,
  type ExpressionType,
} from '@soundor/expression';
import { compileJsFunction } from '@soundor/expression/compiler/js';

import type { ConfigIssue } from './errors';
import {
  INTEGER_PARAMETER_TYPES,
  MAX_INTEGER_PARAMETER_MAGNITUDE,
  MAX_INTEGER_PARAMETER_STEPS,
  PARAMETER_ACCESS,
  semanticsInputs,
  type ChoiceOption,
  type IntegerParameterType,
  type NumericParameterType,
  type ParameterAccess,
  type ParameterSemantics,
  type ResolvedMapping,
  type ResolvedParameter,
} from './parameters';

/** A parameter key: a stable identity, and a name in generated code. */
const ID = /^[A-Za-z][A-Za-z0-9_]*$/;
const FLOAT32_MAX = 3.4028234663852886e38;

const NOT_PARAMETER_TYPES: Record<string, string> = {
  float: "'float' is now 'float32'",
  int: "'int' is now one of the sized integers, such as 'int32'",
  bool: "'bool' is now 'boolean'",
  enum: "'enum' is now 'choice', with options of { value, label }",
  float64:
    "a 'float64' parameter is not supported: hosts carry parameter values as 32-bit floats, so it would only have float32's precision; use 'float32'",
  int64:
    "an 'int64' parameter is not supported: hosts carry parameter values as 32-bit floats, which cannot hold every 64-bit integer; use 'int32' (values within ±2^24), or the native API for wider values",
  uint64:
    "a 'uint64' parameter is not supported: hosts carry parameter values as 32-bit floats, which cannot hold every 64-bit integer; use 'uint32' (values up to 2^24), or the native API for wider values",
};

type Issues = ConfigIssue[];

/** Resolves the declarations; reports every problem in `issues`. */
export function resolveParameters(
  raw: unknown,
  path: string,
  issues: Issues,
  unknownProperty: (key: string) => string,
): ResolvedParameter[] {
  if (raw === undefined) return [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    issues.push({
      path,
      message: Array.isArray(raw)
        ? "parameters are an object of declarations by key, such as { gain: { type: 'float32', … } }, no longer an array"
        : 'expected an object of parameter declarations by key',
    });
    return [];
  }
  const resolved: ResolvedParameter[] = [];
  for (const [id, declaration] of Object.entries(raw)) {
    const at = `${path}.${id}`;
    if (!ID.test(id)) {
      issues.push({
        path: at,
        message: `parameter key '${id}' must start with a letter and hold only letters, digits and underscores; it is the parameter's stable identity`,
      });
      continue;
    }
    const before = issues.length;
    const parameter = resolveParameter(
      id,
      declaration,
      at,
      issues,
      unknownProperty,
    );
    if (parameter !== undefined && issues.length === before) {
      const declarationRecord = declaration as Record<string, unknown>;
      if (declarationRecord['group'] !== undefined) {
        if (
          typeof declarationRecord['group'] !== 'string' ||
          !ID.test(declarationRecord['group'])
        )
          issues.push({
            path: `${at}.group`,
            message: 'expected a parameter group identifier',
          });
        else Object.assign(parameter, { group: declarationRecord['group'] });
      }
      if (declarationRecord['role'] !== undefined) {
        if (declarationRecord['role'] !== 'bypass')
          issues.push({ path: `${at}.role`, message: "expected 'bypass'" });
        else Object.assign(parameter, { role: 'bypass' });
      }
      resolved.push(parameter);
    }
  }
  return resolved;
}

const COMMON = ['type', 'label', 'access', 'group', 'role'];
const NUMERIC = [
  ...COMMON,
  'min',
  'max',
  'default',
  'step',
  'unit',
  'mapping',
  'format',
  'parse',
];

function resolveParameter(
  id: string,
  declaration: unknown,
  path: string,
  issues: Issues,
  unknownProperty: (key: string) => string,
): ResolvedParameter | undefined {
  const fail = (message: string, key?: string): undefined => {
    issues.push({ path: key === undefined ? path : `${path}.${key}`, message });
    return undefined;
  };
  if (
    typeof declaration !== 'object' ||
    declaration === null ||
    Array.isArray(declaration)
  )
    return fail('expected a parameter declaration object');
  const d = declaration as Record<string, unknown>;
  const type = d['type'];
  if (typeof type !== 'string')
    return fail(
      "expected a type, such as 'float32', 'int32', 'boolean' or 'choice'",
      'type',
    );
  if (type in NOT_PARAMETER_TYPES)
    return fail(NOT_PARAMETER_TYPES[type]!, 'type');

  const allowed =
    type === 'boolean'
      ? [...COMMON, 'default']
      : type === 'choice'
        ? [...COMMON, 'options', 'default']
        : NUMERIC;
  for (const key of Object.keys(d))
    if (!allowed.includes(key)) {
      const hint =
        type === 'boolean' || type === 'choice'
          ? [
              'min',
              'max',
              'step',
              'unit',
              'mapping',
              'format',
              'parse',
            ].includes(key)
            ? `; ${type} parameters have no ${key}`
            : ''
          : '';
      fail(
        hint === ''
          ? unknownProperty(key)
          : `${unknownProperty(key).split(';')[0]}${hint}`,
        key,
      );
    }

  let label = id;
  if (d['label'] !== undefined) {
    if (typeof d['label'] !== 'string' || d['label'].trim() === '')
      fail('expected a non-empty label', 'label');
    else label = d['label'].trim();
  }
  let access: ParameterAccess = 'automatable';
  if (d['access'] !== undefined) {
    if (!(PARAMETER_ACCESS as readonly unknown[]).includes(d['access']))
      fail(
        `access is one of ${PARAMETER_ACCESS.map((a) => `'${a}'`).join(', ')}`,
        'access',
      );
    else access = d['access'] as ParameterAccess;
  }

  if (type === 'boolean') {
    if (typeof d['default'] !== 'boolean')
      return fail('expected a boolean default', 'default');
    return {
      id,
      label,
      access,
      type,
      default: d['default'],
      semantics: booleanSemantics(),
    };
  }
  if (type === 'choice')
    return resolveChoice(id, label, access, d, path, issues);
  if (
    type === 'float32' ||
    (INTEGER_PARAMETER_TYPES as readonly string[]).includes(type)
  )
    return resolveNumeric(
      id,
      label,
      access,
      type as NumericParameterType,
      d,
      path,
      issues,
    );
  return fail(
    `unknown parameter type '${type}'; one of ${[...INTEGER_PARAMETER_TYPES, 'float32', 'boolean', 'choice'].map((t) => `'${t}'`).join(', ')}`,
    'type',
  );
}

// ── Choice and boolean ──────────────────────────────────────────────────────

/** ASCII lower case, as the language's `lower`. */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) + 32),
  );
}

function resolveChoice(
  id: string,
  label: string,
  access: ParameterAccess,
  d: Record<string, unknown>,
  path: string,
  issues: Issues,
): ResolvedParameter | undefined {
  const options = d['options'];
  if (!Array.isArray(options) || options.length === 0) {
    issues.push({
      path: `${path}.options`,
      message: 'a choice declares at least one option, { value, label }',
    });
    return undefined;
  }
  const before = issues.length;
  const resolved: ChoiceOption[] = [];
  // Text a host or user may type for an option: its value or its label, in any case.
  const names = new Map<string, number>();
  options.forEach((option: unknown, index) => {
    const at = `${path}.options[${index}]`;
    if (
      typeof option !== 'object' ||
      option === null ||
      Array.isArray(option)
    ) {
      issues.push({
        path: at,
        message:
          'an option is { value, label }; a string alone is not accepted',
      });
      return;
    }
    const o = option as Record<string, unknown>;
    for (const key of Object.keys(o))
      if (key !== 'value' && key !== 'label')
        issues.push({
          path: `${at}.${key}`,
          message: `an option has only a value and a label, not '${key}'`,
        });
    for (const key of ['value', 'label'] as const) {
      const text = o[key];
      if (typeof text !== 'string' || text.trim() === '') {
        issues.push({
          path: `${at}.${key}`,
          message: `expected a non-empty ${key}`,
        });
        return;
      }
      if (text !== text.trim()) {
        issues.push({
          path: `${at}.${key}`,
          message: `the ${key} has leading or trailing whitespace`,
        });
        return;
      }
    }
    const value = o['value'] as string;
    const optionLabel = o['label'] as string;
    for (const [key, text] of [
      ['value', value],
      ['label', optionLabel],
    ] as const) {
      const name = asciiLower(text);
      const other = names.get(name);
      if (other !== undefined && other !== index) {
        const otherOption = resolved[other]!;
        const clash =
          asciiLower(otherOption.value) === name
            ? `value '${otherOption.value}'`
            : `label '${otherOption.label}'`;
        issues.push({
          path: `${at}.${key}`,
          message: `${key} '${text}' is the same text as option ${other}'s ${clash} (ignoring case), so typed text could not tell them apart`,
        });
      }
      names.set(name, index);
    }
    resolved.push({ value, label: optionLabel });
  });
  if (issues.length > before) return undefined;
  const fallback = d['default'];
  if (
    typeof fallback !== 'string' ||
    !resolved.some((option) => option.value === fallback)
  ) {
    issues.push({
      path: `${path}.default`,
      message: `default ${JSON.stringify(fallback)} is not one of the options' values [${resolved.map((o) => `'${o.value}'`).join(', ')}]`,
    });
    return undefined;
  }
  return {
    id,
    label,
    access,
    type: 'choice',
    options: resolved,
    default: fallback,
    semantics: choiceSemantics(resolved),
  };
}

const clamp01 = (t: Expression<'float64'>) =>
  e.max(e.float64(0), e.min(e.float64(1), t));

function booleanSemantics(): ParameterSemantics {
  const n = createContext(semanticsInputs('uint8').toValue);
  const v = createContext({ value: 'uint8' });
  const c = createContext(semanticsInputs('uint8').constrain);
  const t = createContext(semanticsInputs('uint8').parse);
  const one = (x: Expression<'float64'>) =>
    e.if(e.gte(x, 0.5), e.uint8(1), e.uint8(0));
  const words = (s: Expression<'string'>, list: string[]) =>
    e.or(
      ...(list.map((word) => e.eq(s, word)) as [
        Expression<'boolean'>,
        ...Expression<'boolean'>[],
      ]),
    );
  return {
    valueType: 'uint8',
    toValue: one(n.normalized),
    toNormalized: e.convert(v.value, 'float64'),
    constrain: one(c.value),
    format: e.if(e.eq(v.value, 1), 'On', 'Off'),
    parse: e.let(e.lower(e.trim(t.text)), (s) =>
      e.if(
        words(s, ['on', 'true', 'yes', '1']),
        e.uint8(1),
        e.if(
          words(s, ['off', 'false', 'no', '0']),
          e.uint8(0),
          e.null('uint8'),
        ),
      ),
    ),
  };
}

function choiceSemantics(options: readonly ChoiceOption[]): ParameterSemantics {
  const last = options.length - 1;
  const n = createContext(semanticsInputs('uint32').toValue);
  const v = createContext({ value: 'uint32' });
  const c = createContext(semanticsInputs('uint32').constrain);
  const t = createContext(semanticsInputs('uint32').parse);
  const index = (x: Expression<'float64'>) => e.convert(e.round(x), 'uint32');
  let format: Expression<'string'> = e.string(options[last]!.label);
  for (let i = last - 1; i >= 0; i--)
    format = e.if(e.eq(v.value, i), options[i]!.label, format);
  const parse = e.let(e.lower(e.trim(t.text)), (s) => {
    let result: Expression<'uint32?'> = e.null('uint32');
    for (let i = last; i >= 0; i--) {
      const option = options[i]!;
      const names = [
        ...new Set([asciiLower(option.value), asciiLower(option.label)]),
      ];
      const matches = e.or(
        ...(names.map((name) => e.eq(s, name)) as [
          Expression<'boolean'>,
          ...Expression<'boolean'>[],
        ]),
      );
      result = e.if(matches, e.uint32(i), result);
    }
    return result;
  });
  return {
    valueType: 'uint32',
    toValue: index(e.mul(clamp01(n.normalized), last)),
    toNormalized:
      last === 0 ? e.float64(0) : e.div(e.convert(v.value, 'float64'), last),
    constrain: index(e.max(e.float64(0), e.min(e.float64(last), c.value))),
    format,
    parse,
  };
}

// ── Numeric ─────────────────────────────────────────────────────────────────

interface NumericShape {
  readonly type: NumericParameterType;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly unit?: string;
}

function resolveNumeric(
  id: string,
  label: string,
  access: ParameterAccess,
  type: NumericParameterType,
  d: Record<string, unknown>,
  path: string,
  issues: Issues,
): ResolvedParameter | undefined {
  const before = issues.length;
  const fail = (key: string, message: string) => {
    issues.push({ path: `${path}.${key}`, message });
  };
  const integer = type !== 'float32';
  const numbers: Record<'min' | 'max' | 'default', number> = {
    min: 0,
    max: 0,
    default: 0,
  };
  for (const key of ['min', 'max', 'default'] as const) {
    const value = d[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      fail(key, `expected a finite number for ${key}`);
      continue;
    }
    numbers[key] = Object.is(value, -0) ? 0 : value;
    if (integer) {
      const bounds = INTEGERS[type as IntegerParameterType];
      if (!Number.isInteger(value))
        fail(
          key,
          `${key} (${value}) of an '${type}' parameter must be an integer`,
        );
      else if (BigInt(value) < bounds.min || BigInt(value) > bounds.max)
        fail(
          key,
          `${key} (${value}) is outside '${type}' (${bounds.min} to ${bounds.max})`,
        );
      else if (Math.abs(value) > MAX_INTEGER_PARAMETER_MAGNITUDE)
        fail(
          key,
          `${key} (${value}) is beyond ±${MAX_INTEGER_PARAMETER_MAGNITUDE} (2^24): hosts carry parameters as 32-bit floats, which hold integers exactly only up to there`,
        );
    } else if (Math.abs(value) > FLOAT32_MAX)
      fail(key, `${key} (${value}) is beyond the range of a float32`);
  }
  if (issues.length > before) return undefined;
  const { min, max } = numbers;
  if (!(min < max)) {
    fail('min', `min (${min}) must be below max (${max})`);
    return undefined;
  }
  if (integer && max - min > MAX_INTEGER_PARAMETER_STEPS)
    fail(
      'max',
      `the range spans ${max - min} values, more than ${MAX_INTEGER_PARAMETER_STEPS} (2^23): hosts carry parameters as normalized 32-bit floats, which tell at most that many steps apart exactly`,
    );

  let step: number | undefined;
  if (d['step'] !== undefined) {
    const value = d['step'];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
      fail('step', 'a step is a finite number above 0');
    else if (integer && !Number.isInteger(value))
      fail('step', `the step of an '${type}' parameter is an integer`);
    else if (integer && (max - min) % value !== 0)
      fail(
        'step',
        `the step (${value}) must divide the range (${max - min}), so the values are evenly spaced as hosts expect`,
      );
    else if (value > max - min)
      fail(
        'step',
        `the step (${value}) is larger than the range (${max - min})`,
      );
    else step = value;
  }
  let unit: string | undefined;
  if (d['unit'] !== undefined) {
    if (typeof d['unit'] !== 'string' || d['unit'].trim() === '')
      fail('unit', "expected a non-empty unit, such as 'Hz'");
    else unit = d['unit'].trim();
  }
  const mapping = resolveMapping(
    d['mapping'],
    type,
    min,
    `${path}.mapping`,
    issues,
  );
  if (issues.length > before || mapping === undefined) return undefined;

  const shape: NumericShape = {
    type,
    min,
    max,
    ...(step !== undefined && { step }),
    ...(unit !== undefined && { unit }),
  };
  const semantics = numericSemantics(shape, mapping, d, path, issues);
  if (semantics === undefined) return undefined;

  // The default is a legal value: on the grid, within the range.
  const fallback = numbers.default;
  const constrain = evaluator(
    semantics.constrain,
    semanticsInputs(type).constrain,
  );
  const legal = constrain(fallback) as number;
  const asType = type === 'float32' ? Math.fround(fallback) : fallback;
  if (fallback < min || fallback > max) {
    fail(
      'default',
      `default (${fallback}) is out of range; set it within [${min}, ${max}]`,
    );
    return undefined;
  }
  if (legal !== asType) {
    fail(
      'default',
      `default (${fallback}) is not a legal value: with step ${step} from ${min}, the nearest is ${legal}`,
    );
    return undefined;
  }
  checkBehavior(shape, semantics, mapping.declared, d, path, issues);
  if (issues.length > before) return undefined;

  return {
    id,
    label,
    access,
    type,
    min,
    max,
    default: fallback,
    ...(step !== undefined && { step }),
    ...(unit !== undefined && { unit }),
    mapping: mapping.resolved,
    semantics,
  };
}

interface MappingParts {
  readonly resolved: ResolvedMapping;
  /** The user's own expressions, for a custom mapping. */
  readonly declared?: {
    toValue: Expression<'float64'>;
    toNormalized: Expression<'float64'>;
  };
}

function resolveMapping(
  raw: unknown,
  type: NumericParameterType,
  min: number,
  path: string,
  issues: Issues,
): MappingParts | undefined {
  const fail = (message: string, at = path): undefined => {
    issues.push({ path: at, message });
    return undefined;
  };
  if (raw === undefined || raw === 'linear')
    return { resolved: { type: 'linear' } };
  if (type !== 'float32')
    return fail(
      `an '${type}' parameter is linear: hosts space a discrete parameter's values evenly in normalized range, so a curve would disagree with them`,
    );
  if (raw === 'log') {
    if (!(min > 0)) return fail(`a log mapping needs min above 0, got ${min}`);
    return { resolved: { type: 'log' } };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return fail(
      "a mapping is 'linear', 'log', { type: 'power', exponent }, { type: 'symmetricPower', exponent } or { type: 'custom', toValue, toNormalized }",
    );
  const m = raw as Record<string, unknown>;
  const kind = m['type'];
  if (kind === 'power' || kind === 'symmetricPower') {
    for (const key of Object.keys(m))
      if (key !== 'type' && key !== 'exponent')
        fail(
          `a ${kind} mapping has only an exponent, not '${key}'`,
          `${path}.${key}`,
        );
    const exponent = m['exponent'];
    if (
      typeof exponent !== 'number' ||
      !Number.isFinite(exponent) ||
      exponent <= 0
    )
      return fail(
        'the exponent is a finite number above 0',
        `${path}.exponent`,
      );
    return { resolved: { type: kind, exponent } };
  }
  if (kind === 'custom') {
    for (const key of Object.keys(m))
      if (!['type', 'toValue', 'toNormalized'].includes(key))
        fail(
          `a custom mapping has toValue and toNormalized, not '${key}'`,
          `${path}.${key}`,
        );
    const toValue = build(
      m['toValue'],
      { normalized: 'float64' },
      'float64',
      `${path}.toValue`,
      issues,
    );
    const toNormalized = build(
      m['toNormalized'],
      { value: 'float64' },
      'float64',
      `${path}.toNormalized`,
      issues,
    );
    if (toValue === undefined || toNormalized === undefined) return undefined;
    return {
      resolved: { type: 'custom' },
      declared: {
        toValue: toValue as Expression<'float64'>,
        toNormalized: toNormalized as Expression<'float64'>,
      },
    };
  }
  return fail(
    `unknown mapping type ${JSON.stringify(kind)}; 'power', 'symmetricPower' or 'custom'`,
    `${path}.type`,
  );
}

/** Calls a user's expression callback with its context; checks what it built. */
function build(
  callback: unknown,
  inputs: ExpressionInputs,
  expected: ExpressionType,
  path: string,
  issues: Issues,
): Expression | undefined {
  if (typeof callback !== 'function') {
    issues.push({
      path,
      message:
        'expected a function that builds an expression, such as (e) => …',
    });
    return undefined;
  }
  let result: unknown;
  try {
    result = (callback as (context: unknown) => unknown)(createContext(inputs));
  } catch (error) {
    issues.push({
      path,
      message: `building the expression failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    return undefined;
  }
  const problems = checkExpression(result, inputs, { expected });
  for (const problem of problems)
    issues.push({
      path: problem.path === '' ? path : `${path}.${problem.path}`,
      message: problem.message,
    });
  return problems.length === 0 ? (result as Expression) : undefined;
}

/**
 * A mapping's continuous curve, normalized (clamped, float64) → value
 * (float64), and its inverse, both in float64.
 */
function curves(shape: NumericShape, mapping: MappingParts) {
  const { min, max } = shape;
  const span = max - min;
  const m = mapping.resolved;
  const unit = (v: Expression<'float64'>) => e.div(e.sub(v, min), span);
  const scale = (u: Expression<'float64'>) =>
    e.add(e.float64(min), e.mul(u, span));
  switch (m.type) {
    case 'linear':
      return { curve: scale, inverse: unit };
    case 'log': {
      const ratio = max / min;
      return {
        curve: (t: Expression<'float64'>) =>
          e.mul(e.float64(min), e.pow(e.float64(ratio), t)),
        inverse: (v: Expression<'float64'>) =>
          e.div(e.log(e.div(v, min)), Math.log(ratio)),
      };
    }
    case 'power':
      return {
        curve: (t: Expression<'float64'>) => scale(e.pow(t, m.exponent)),
        inverse: (v: Expression<'float64'>) => e.pow(unit(v), 1 / m.exponent),
      };
    case 'symmetricPower': {
      const k = m.exponent;
      const half = (x: Expression<'float64'>, p: number) =>
        e.mul(0.5, e.pow(e.mul(2, x), p));
      const shaped = (x: Expression<'float64'>, p: number) =>
        e.let(x, (w) =>
          e.if(
            e.lte(w, 0.5),
            half(w, p),
            e.sub(e.float64(1), half(e.sub(e.float64(1), w), p)),
          ),
        );
      return {
        curve: (t: Expression<'float64'>) => scale(shaped(t, k)),
        inverse: (v: Expression<'float64'>) => shaped(unit(v), 1 / k),
      };
    }
    case 'custom': {
      const declared = mapping.declared!;
      return {
        curve: (t: Expression<'float64'>) =>
          substituteInputs(declared.toValue, { normalized: t }),
        inverse: (v: Expression<'float64'>) =>
          substituteInputs(declared.toNormalized, { value: v }),
      };
    }
  }
}

/** Decimals the default format shows: the step's, or what the range suggests. */
export function defaultDecimals(shape: NumericShape): number {
  if (shape.type !== 'float32') return 0;
  if (shape.step !== undefined) {
    const [mantissa, exponent] = String(shape.step).split('e');
    const fraction = mantissa!.split('.')[1]?.length ?? 0;
    return Math.min(6, Math.max(0, fraction - Number(exponent ?? 0)));
  }
  return Math.min(
    6,
    Math.max(0, 3 - Math.ceil(Math.log10(shape.max - shape.min))),
  );
}

function numericSemantics(
  shape: NumericShape,
  mapping: MappingParts,
  d: Record<string, unknown>,
  path: string,
  issues: Issues,
): ParameterSemantics | undefined {
  const { type, min, max, step } = shape;
  const inputs = semanticsInputs(type);
  const { curve, inverse } = curves(shape, mapping);
  const n = createContext(inputs.toValue);
  const v = createContext(inputs.toNormalized);
  const c = createContext(inputs.constrain);
  const t = createContext(inputs.parse);
  const asType = (x: Expression<'float64'>) => e.convert(x, type) as Expression;
  const literal = (x: number) =>
    (type === 'float32' ? e.float32(x) : e.literal(type, x)) as Expression;

  /** Any float64 → the nearest legal value, of the parameter's type. */
  const snap = (x: Expression<'float64'>): Expression =>
    e.let(e.max(e.float64(min), e.min(e.float64(max), x)), (clamped) => {
      // Integers step by 1 unless told otherwise.
      const grain = step ?? (type === 'float32' ? undefined : 1);
      if (grain === undefined) return asType(clamped);
      const grid = e.min(
        e.float64(max),
        e.add(
          e.float64(min),
          e.mul(e.round(e.div(e.sub(clamped, min), grain)), grain),
        ),
      );
      if (type !== 'float32') return asType(grid);
      // The last step may be shorter: max is a legal value too.
      return asType(
        e.let(grid, (g) =>
          e.if(
            e.lt(e.sub(e.float64(max), clamped), e.sub(clamped, g)),
            e.float64(max),
            g,
          ),
        ),
      );
    });

  const toValue =
    type === 'float32'
      ? e.let(clamp01(n.normalized), (u) =>
          e.if(
            e.lte(u, 0),
            literal(min) as Expression<'float32'>,
            e.if(
              e.gte(u, 1),
              literal(max) as Expression<'float32'>,
              snap(curve(u)) as Expression<'float32'>,
            ),
          ),
        )
      : snap(e.add(e.float64(min), e.mul(clamp01(n.normalized), max - min)));

  const value64 = e.convert(
    v.value as Expression<NumericParameterType>,
    'float64',
  );
  const toNormalized =
    type === 'float32'
      ? e.let(e.max(e.float64(min), e.min(e.float64(max), value64)), (x) =>
          e.if(
            e.lte(x, min),
            e.float64(0),
            e.if(e.gte(x, max), e.float64(1), clamp01(inverse(x))),
          ),
        )
      : e.div(e.sub(value64, min), max - min);

  // Text.
  const formatContext = inputs.format as ExpressionInputs;
  let format: Expression<'string'>;
  const declaredFormat = d['format'];
  const declaredParse = d['parse'];
  if (declaredFormat !== undefined) {
    if (declaredParse === undefined) {
      issues.push({
        path: `${path}.parse`,
        message:
          "a custom format needs a parse that reads what it writes, or parse: 'default' for the number parser",
      });
      return undefined;
    }
    const built = build(
      declaredFormat,
      formatContext,
      'string',
      `${path}.format`,
      issues,
    );
    if (built === undefined) return undefined;
    format = built as Expression<'string'>;
  } else {
    const number = e.fixed(
      v.value as Expression<NumericParameterType>,
      defaultDecimals(shape),
    );
    format =
      shape.unit === undefined ? number : e.concat(number, ` ${shape.unit}`);
  }

  let parsed: Expression;
  if (declaredParse !== undefined && declaredParse !== 'default') {
    const built = build(
      declaredParse,
      inputs.parse,
      `${type}?`,
      `${path}.parse`,
      issues,
    );
    if (built === undefined) return undefined;
    parsed = built;
  } else {
    const unit = shape.unit;
    parsed =
      unit === undefined
        ? e.parse(t.text, type)
        : e.let(e.lower(e.trim(t.text)), (s) =>
            e.parse(e.removeSuffix(s, asciiLower(unit)), type),
          );
  }
  // Out of range is not a value; within it, snapped to the step.
  const parse = e.map(parsed as Expression<`${NumericParameterType}?`>, (p) =>
    e.if(
      e.and(e.gte(p, literal(min) as never), e.lte(p, literal(max) as never)),
      snap(e.convert(p, 'float64')) as Expression<NumericParameterType>,
      e.null(type) as Expression<`${NumericParameterType}?`>,
    ),
  );

  return {
    valueType: type,
    toValue,
    toNormalized,
    constrain: snap(c.value),
    format,
    parse,
  };
}

// ── Numeric checks of what was built ────────────────────────────────────────

function evaluator(expression: Expression, inputs: ExpressionInputs) {
  const fn = compileJsFunction(expression, inputs);
  return (...values: unknown[]) => fn(...values);
}

const SAMPLES = 1024;

function checkBehavior(
  shape: NumericShape,
  semantics: ParameterSemantics,
  declared: MappingParts['declared'],
  d: Record<string, unknown>,
  path: string,
  issues: Issues,
): void {
  const { min, max } = shape;
  const span = max - min;
  const close = (a: number, b: number, scale: number) =>
    Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(scale));

  // A custom mapping: finite, increasing, ending at the bounds, inverting itself.
  if (declared !== undefined) {
    const at = `${path}.mapping`;
    const toValue = evaluator(declared.toValue, { normalized: 'float64' });
    const toNormalized = evaluator(declared.toNormalized, { value: 'float64' });
    const start = toValue(0) as number;
    const end = toValue(1) as number;
    if (!close(start, min, span) || !close(end, max, span)) {
      issues.push({
        path: `${at}.toValue`,
        message: `toValue must map 0 to min (${min}) and 1 to max (${max}); it gives ${start} and ${end}`,
      });
      return;
    }
    if (
      !close(toNormalized(min) as number, 0, 1) ||
      !close(toNormalized(max) as number, 1, 1)
    ) {
      issues.push({
        path: `${at}.toNormalized`,
        message: `toNormalized must map min to 0 and max to 1; it gives ${toNormalized(min)} and ${toNormalized(max)}`,
      });
      return;
    }
    const values: number[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const u = i / SAMPLES;
      const value = toValue(u) as number;
      if (!Number.isFinite(value)) {
        issues.push({
          path: `${at}.toValue`,
          message: `toValue(${u}) is ${value}; it must be finite in [0, 1]`,
        });
        return;
      }
      if (i > 0 && value < values[i - 1]!) {
        issues.push({
          path: `${at}.toValue`,
          message: `toValue must increase: toValue(${u}) = ${value} is below toValue(${(i - 1) / SAMPLES}) = ${values[i - 1]}`,
        });
        return;
      }
      values.push(value);
    }
    for (const [i, value] of values.entries()) {
      const u = i / SAMPLES;
      const back = toNormalized(value) as number;
      if (!Number.isFinite(back) || Math.abs(back - u) > 1e-6) {
        issues.push({
          path: `${at}.toNormalized`,
          message: `toNormalized does not invert toValue: toValue(${u}) = ${value}, and toNormalized of it is ${back}`,
        });
        return;
      }
    }
  }

  // Text: what format writes, parse reads back to a value that formats the same.
  const inputs = semanticsInputs(shape.type);
  const toValue = evaluator(semantics.toValue, inputs.toValue);
  const format = evaluator(semantics.format, inputs.format as ExpressionInputs);
  const parse = evaluator(semantics.parse, inputs.parse);
  const samples = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1].map(
    (u) => toValue(u) as number,
  );
  const at =
    d['parse'] !== undefined && d['parse'] !== 'default'
      ? `${path}.parse`
      : d['format'] !== undefined
        ? `${path}.format`
        : path;
  for (const value of samples) {
    const text = format(value) as string;
    const back = parse(text) as number | null;
    if (back === null) {
      issues.push({
        path: at,
        message: `parse does not read what format writes: format(${value}) is '${text}', which parse rejects`,
      });
      return;
    }
    const again = format(back) as string;
    if (again !== text) {
      issues.push({
        path: at,
        message: `parse does not read back what format writes: '${text}' parses to ${back}, which formats as '${again}'`,
      });
      return;
    }
  }
}

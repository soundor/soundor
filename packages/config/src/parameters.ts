/**
 * Parameters: how a config declares them, and what a runtime receives.
 *
 * A config declares each parameter under its key, a stable identity that
 * hosts store in sessions and automation; `label` is only what they show.
 * Validation resolves every declaration into a {@link ResolvedParameter}: its
 * metadata, and its behavior — normalized mapping, quantization, text — as
 * typed expressions ({@link ParameterSemantics}) that each runtime compiles
 * into its own language. Soundor defines what a parameter does; runtimes
 * implement it, from one definition.
 */

import type { Expression, ExpressionContext } from '@soundor/expression';

/**
 * Who may change a parameter:
 *
 * - `automatable` (the default): the UI, and the host's automation;
 * - `manual`: the UI and the host's controls, but hosts do not record or play
 *   back automation of it;
 * - `readOnly`: only the plugin's processing, which publishes it (a meter);
 *   the UI and the host read it.
 */
export type ParameterAccess = 'automatable' | 'manual' | 'readOnly';

export const PARAMETER_ACCESS = ['automatable', 'manual', 'readOnly'] as const;

/**
 * Integer parameter types. Hosts carry parameters as normalized 32-bit
 * floats, so an `int32` or `uint32` parameter's values must lie within
 * ±2^24 and its range span at most 2^23 steps: then every value survives
 * automation exactly.
 */
export const INTEGER_PARAMETER_TYPES = [
  'int8',
  'uint8',
  'int16',
  'uint16',
  'int32',
  'uint32',
] as const;

export type IntegerParameterType = (typeof INTEGER_PARAMETER_TYPES)[number];
/** Numeric parameter types: the integers above, and `float32`. */
export type NumericParameterType = IntegerParameterType | 'float32';
export type ParameterType = NumericParameterType | 'boolean' | 'choice';

export const PARAMETER_TYPES: readonly ParameterType[] = [
  ...INTEGER_PARAMETER_TYPES,
  'float32',
  'boolean',
  'choice',
];

/** The largest magnitude of an integer parameter's value: exact in a float. */
export const MAX_INTEGER_PARAMETER_MAGNITUDE = 2 ** 24;
/** The most steps an integer parameter's range spans: exact through a normalized float. */
export const MAX_INTEGER_PARAMETER_STEPS = 2 ** 23;

/** What every parameter declares. */
export interface ParameterBase {
  /** Host-visible group, referring to a key in parameterGroups. */
  group?: string;
  /** Identifies the host bypass parameter; does not implement bypass DSP. */
  role?: 'bypass';
  /** What hosts and generic editors show; the parameter's key by default. Not an identity. */
  label?: string;
  /** Who may change it; `'automatable'` by default. */
  access?: ParameterAccess;
}

/** What a mapping's `toValue` receives: `e.normalized`, a float64 in [0, 1]. */
export type ToValueContext = ExpressionContext<{ normalized: 'float64' }>;
/** What a mapping's `toNormalized` receives: `e.value`, a float64 within the range. */
export type ToNormalizedContext = ExpressionContext<{ value: 'float64' }>;
/** What `format` receives: `e.value`, of the parameter's type. */
export type FormatContext<T extends NumericParameterType> = ExpressionContext<{
  value: T;
}>;
/** What `parse` receives: `e.text`. */
export type ParseContext = ExpressionContext<{ text: 'string' }>;

/** Display text of a value: `(e) => e.concat(e.fixed(e.value, 2), ' dB')`. */
export type Formatter<T extends NumericParameterType> = (
  e: FormatContext<T>,
) => Expression<'string'>;
/** A value of the parameter's type read from text, or null. */
export type Parser<T extends NumericParameterType> = (
  e: ParseContext,
) => Expression<`${T}?`>;

/** `value = min + (max - min) · t^exponent`. */
export interface PowerMapping {
  type: 'power';
  /** Finite and positive; above 1 gives the low end more travel. */
  exponent: number;
}

/** A power curve on each half, symmetric about the range's midpoint. */
export interface SymmetricPowerMapping {
  type: 'symmetricPower';
  /** Finite and positive; above 1 gives the middle more travel. */
  exponent: number;
}

/**
 * A mapping of your own, both directions as expressions in float64. It must
 * be increasing, map 0 to `min` and 1 to `max`, and its two directions must
 * invert each other; validation checks this numerically.
 */
export interface CustomMapping {
  type: 'custom';
  /** Normalized position (`e.normalized`) to value. */
  toValue: (e: ToValueContext) => Expression<'float64'>;
  /** Value (`e.value`) to normalized position. */
  toNormalized: (e: ToNormalizedContext) => Expression<'float64'>;
}

/**
 * How a normalized position in [0, 1] (a host's automation, a knob's travel)
 * maps to a value:
 *
 * - `'linear'` (the default): `min + t · (max - min)`;
 * - `'log'`: `min · (max / min)^t`, for frequencies and other ratios
 *   (`min` above 0);
 * - `{ type: 'power', exponent }`, `{ type: 'symmetricPower', exponent }`;
 * - `{ type: 'custom', toValue, toNormalized }`.
 */
export type Mapping =
  | 'linear'
  | 'log'
  | PowerMapping
  | SymmetricPowerMapping
  | CustomMapping;

/**
 * How values are shown and read. Without `format`, a number is shown with
 * the decimals its step or range suggests and its `unit`; without `parse`,
 * text is read as a number, the unit optional. A custom `format` needs a
 * `parse` that reads what it writes, or `parse: 'default'`.
 */
export type TextConversion<T extends NumericParameterType> =
  | {
      format?: undefined;
      /** Reads typed text; `'default'` is the number parser. */
      parse?: Parser<T> | 'default';
    }
  | {
      /** The value as display text. */
      format: Formatter<T>;
      /** Reads what `format` writes; `'default'` is the number parser. */
      parse: Parser<T> | 'default';
    };

interface NumericParameterFields<
  T extends NumericParameterType,
> extends ParameterBase {
  type: T;
  min: number;
  max: number;
  /** Within [min, max], and a legal value when there is a `step`. */
  default: number;
  /**
   * Values are `min + k · step` (and `max`): every value is snapped to the
   * nearest. A float's last step may be shorter than the others; an
   * integer's step divides its range.
   */
  step?: number;
  /** The unit hosts show next to the value (`'Hz'`, `'dB'`); not a formatter. */
  unit?: string;
}

/** A 32-bit float parameter: continuous, or quantized by `step`. */
export type Float32Parameter = NumericParameterFields<'float32'> & {
  /** `'linear'` by default. */
  mapping?: Mapping;
} & TextConversion<'float32'>;

/**
 * An integer parameter. Its mapping is linear: hosts space a discrete
 * parameter's values evenly in normalized range.
 */
export type IntegerParameter<
  T extends IntegerParameterType = IntegerParameterType,
> = T extends IntegerParameterType
  ? NumericParameterFields<T> & { mapping?: 'linear' } & TextConversion<T>
  : never;

export type NumericParameter = Float32Parameter | IntegerParameter;

/** An on/off switch; hosts show it as On and Off. */
export interface BooleanParameter extends ParameterBase {
  type: 'boolean';
  default: boolean;
}

/** One option of a choice: `value` in code, `label` on screen. */
export interface ChoiceOption<V extends string = string> {
  readonly value: V;
  readonly label: string;
}

/**
 * One of a list of options. Its values are a string union in code; hosts
 * store the option's index, so reordering or removing options changes what
 * saved sessions and automation mean. Add new options at the end.
 */
export interface ChoiceParameter<
  V extends string = string,
> extends ParameterBase {
  type: 'choice';
  options: readonly ChoiceOption<V>[];
  /** One of the options' values. */
  default: NoInfer<V>;
}

/** Any parameter declaration. */
export type Parameter =
  | Float32Parameter
  | IntegerParameter
  | BooleanParameter
  | ChoiceParameter;

/** A config's parameters, by key. */
export type ParameterDeclarations = Readonly<Record<string, Parameter>>;

// ── Type checks that need the declared literal values ────────────────────────

/** The options, with a type error on a value or label an earlier option has. */
type UniqueOptions<
  O extends readonly ChoiceOption[],
  Values extends string = never,
  Labels extends string = never,
> = O extends readonly [
  infer Head extends ChoiceOption,
  ...infer Rest extends readonly ChoiceOption[],
]
  ? readonly [
      {
        readonly value: Lowercase<Head['value']> extends Values
          ? `option value '${Head['value']}' is repeated`
          : Head['value'];
        readonly label: Lowercase<Head['label']> extends Labels
          ? `option label '${Head['label']}' is repeated`
          : Head['label'];
      },
      ...UniqueOptions<
        Rest,
        Values | Lowercase<Head['value']>,
        Labels | Lowercase<Head['label']>
      >,
    ]
  : O;

/** What a declaration must be, given what it says it is. */
export type CheckParameter<X> = X extends {
  type: 'choice';
  options: infer O extends readonly ChoiceOption[];
}
  ? Omit<ChoiceParameter<O[number]['value']>, 'options'> & {
      options: UniqueOptions<O>;
    }
  : X extends { type: 'float32' }
    ? Float32Parameter
    : X extends { type: infer T extends IntegerParameterType }
      ? IntegerParameter<T>
      : X extends { type: 'boolean' }
        ? BooleanParameter
        : Parameter;

type AllKeys<T> = T extends unknown ? keyof T : never;

/**
 * Declarations checked one by one against their own `type`: a declaration
 * that fits is kept as written (so its literals stay inferred), one that does
 * not is held to what it should be, which reports the property at fault.
 */
export type CheckedParameters<P> = {
  [K in keyof P]: P[K] extends CheckParameter<P[K]>
    ? [Exclude<keyof P[K], AllKeys<CheckParameter<P[K]>>>] extends [never]
      ? P[K]
      : CheckParameter<P[K]>
    : CheckParameter<P[K]>;
};

// ── Resolved form: what runtimes receive ────────────────────────────────────

/** The mapping a numeric parameter resolved to: descriptive; its math is in `semantics`. */
export type ResolvedMapping =
  | { readonly type: 'linear' }
  | { readonly type: 'log' }
  | { readonly type: 'power'; readonly exponent: number }
  | { readonly type: 'symmetricPower'; readonly exponent: number }
  | { readonly type: 'custom' };

/**
 * A parameter's values as numbers in expressions: its own type for numeric
 * parameters, `uint8` (0 or 1) for booleans, `uint32` (the option's index)
 * for choices. Hosts hold them the same way.
 */
export type ParameterValueType = NumericParameterType;

/**
 * Everything a parameter does, as expressions over its {@link
 * ParameterValueType} `V`, with the inputs {@link semanticsInputs} names.
 * Runtimes compile them; none of them depends on the UI running.
 */
export interface ParameterSemantics {
  readonly valueType: ParameterValueType;
  /** `normalized` (float64, any number) → the value: clamped to [0, 1], mapped, snapped. */
  readonly toValue: Expression;
  /** `value` (a legal value) → normalized float64 in [0, 1]. */
  readonly toNormalized: Expression<'float64'>;
  /** `value` (any finite float64) → the nearest legal value. */
  readonly constrain: Expression;
  /** `value` → display text, without being able to fail. */
  readonly format: Expression<'string'>;
  /** `text` → a legal value, or null for text that is not one (or is out of range). */
  readonly parse: Expression;
}

/** The inputs of each expression of {@link ParameterSemantics}. */
export function semanticsInputs(valueType: ParameterValueType) {
  return {
    toValue: { normalized: 'float64' },
    toNormalized: { value: valueType },
    constrain: { value: 'float64' },
    format: { value: valueType },
    parse: { text: 'string' },
  } as const;
}

interface ResolvedParameterBase {
  readonly group?: string;
  readonly role?: 'bypass';
  /** Its key in the config: a stable identity. */
  readonly id: string;
  readonly label: string;
  readonly access: ParameterAccess;
  readonly semantics: ParameterSemantics;
}

export interface ResolvedNumericParameter extends ResolvedParameterBase {
  readonly type: NumericParameterType;
  readonly min: number;
  readonly max: number;
  readonly default: number;
  readonly step?: number;
  readonly unit?: string;
  readonly mapping: ResolvedMapping;
}

export interface ResolvedBooleanParameter extends ResolvedParameterBase {
  readonly type: 'boolean';
  readonly default: boolean;
}

export interface ResolvedChoiceParameter extends ResolvedParameterBase {
  readonly type: 'choice';
  readonly options: readonly ChoiceOption[];
  readonly default: string;
}

/** A validated parameter, every field decided. */
export type ResolvedParameter =
  | ResolvedNumericParameter
  | ResolvedBooleanParameter
  | ResolvedChoiceParameter;

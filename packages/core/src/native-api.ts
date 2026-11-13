/**
 * The typed native API a plugin declares under `native` in its config, and the
 * model every generator works from.
 *
 * Config authors write a compact, human-readable form:
 *
 * ```ts
 * native: {
 *   types: {
 *     Analysis: { struct: { rms: 'float32', peak: 'float32' } },
 *     Curve: { enum: ['linear', 'exponential'] },
 *     Preset: { struct: { name: 'string', gains: 'float32[]' } },
 *   },
 *   methods: {
 *     analyze: { args: { samples: 'buffer<float32>' }, returns: 'Analysis' },
 *     loadPreset: { args: { path: 'string' }, returns: 'Preset?', async: true },
 *   },
 *   events: {
 *     presetLoaded: { path: 'string' },
 *   },
 * }
 * ```
 *
 * The schema is language-neutral: its types say what a value is (a 32-bit
 * float, an array, contiguous numbers), not what JavaScript or C++ calls it.
 * {@link describeNativeApi} validates that form and resolves it into a
 * {@link NativeApiModel}: every type reference parsed, names sorted, so the
 * TypeScript declarations and the C++ bindings are generated from one
 * deterministic description.
 */

// ── Config form ──────────────────────────────────────────────────────────────

/**
 * A type reference:
 *
 * - a primitive: `'boolean'`, `'string'`, a sized integer (`'int8'` …
 *   `'uint64'`) or float (`'float32'`, `'float64'`);
 * - a type declared under `native.types` (`'Preset'`);
 * - `'T[]'`, an array (a list of values) of a primitive or declared type;
 * - `'buffer<T>'`, contiguous binary numbers of one sized numeric type;
 * - any of these followed by `?`, which also accepts `null`.
 *
 * `'void'` is only valid as a return type.
 */
export type NativeTypeRef = string;

/** A type declared under `native.types`. */
export type NativeTypeDeclaration =
  | { readonly struct: Readonly<Record<string, NativeTypeRef>> }
  | { readonly enum: readonly string[] };

/** A method declared under `native.methods`. Argument order is positional. */
export interface NativeMethodDeclaration {
  readonly args?: Readonly<Record<string, NativeTypeRef>>;
  /** Defaults to `'void'`. */
  readonly returns?: NativeTypeRef;
  /** Returns a Promise; the native side settles it later on the UI thread. */
  readonly async?: boolean;
}

/**
 * An event declared under `native.events`: the fields of the value native
 * code publishes and the UI's subscribers receive, in order.
 */
export type NativeEventDeclaration = Readonly<Record<string, NativeTypeRef>>;

/** The `native` section of a Soundor config. */
export interface NativeApiDeclaration {
  readonly types?: Readonly<Record<string, NativeTypeDeclaration>>;
  readonly methods?: Readonly<Record<string, NativeMethodDeclaration>>;
  /** Discrete notifications from native code to the UI. */
  readonly events?: Readonly<Record<string, NativeEventDeclaration>>;
}

// ── Resolved model ──────────────────────────────────────────────────────────

/** Integers: up to 32 bits a JavaScript number, 64 bits a bigint. */
export const INTEGER_TYPES = [
  'int8',
  'uint8',
  'int16',
  'uint16',
  'int32',
  'uint32',
  'int64',
  'uint64',
] as const;
export const FLOAT_TYPES = ['float32', 'float64'] as const;
/** The fixed-width numeric types, the only ones a `buffer<T>` holds. */
export const NUMERIC_TYPES = [...INTEGER_TYPES, ...FLOAT_TYPES] as const;
export const PRIMITIVE_TYPES = ['boolean', 'string', ...NUMERIC_TYPES] as const;

export type IntegerTypeName = (typeof INTEGER_TYPES)[number];
export type NumericTypeName = (typeof NUMERIC_TYPES)[number];
export type PrimitiveTypeName = (typeof PRIMITIVE_TYPES)[number];

/** The JavaScript typed array a `buffer<T>` is, by element type. */
export const BUFFER_ARRAY_TYPES = {
  int8: 'Int8Array',
  uint8: 'Uint8Array',
  int16: 'Int16Array',
  uint16: 'Uint16Array',
  int32: 'Int32Array',
  uint32: 'Uint32Array',
  int64: 'BigInt64Array',
  uint64: 'BigUint64Array',
  float32: 'Float32Array',
  float64: 'Float64Array',
} as const satisfies Record<NumericTypeName, string>;

export type NativeType =
  | { readonly kind: 'void' }
  | { readonly kind: 'primitive'; readonly name: PrimitiveTypeName }
  | {
      readonly kind: 'declared';
      readonly name: string;
      readonly declaration: 'struct' | 'enum';
    }
  /** `T[]`: a list of values, copied across. */
  | { readonly kind: 'array'; readonly element: NativeType }
  /** `buffer<T>`: contiguous binary numbers. */
  | { readonly kind: 'buffer'; readonly element: NumericTypeName }
  /** `T?`: `T` or `null`. Never nested, never void. */
  | { readonly kind: 'nullable'; readonly inner: NativeType };

export interface NativeField {
  readonly name: string;
  readonly type: NativeType;
}

export type NativeTypeModel =
  | {
      readonly kind: 'struct';
      readonly name: string;
      readonly fields: readonly NativeField[];
    }
  | {
      readonly kind: 'enum';
      readonly name: string;
      readonly values: readonly string[];
    };

export interface NativeMethodModel {
  readonly name: string;
  readonly args: readonly NativeField[];
  readonly returns: NativeType;
  readonly async: boolean;
}

/** An event: what native code publishes, as named fields. */
export interface NativeEventModel {
  readonly name: string;
  readonly fields: readonly NativeField[];
}

export interface NativeApiModel {
  /** Declared types, ordered so every struct follows the structs it contains. */
  readonly types: readonly NativeTypeModel[];
  /** Methods sorted by name. */
  readonly methods: readonly NativeMethodModel[];
  /** Events sorted by name. */
  readonly events: readonly NativeEventModel[];
}

export interface NativeApiIssue {
  /** Config path, e.g. `native.methods.analyze.args.samples`. */
  readonly path: string;
  readonly message: string;
}

export type NativeApiResult =
  | { readonly ok: true; readonly model: NativeApiModel }
  | { readonly ok: false; readonly issues: readonly NativeApiIssue[] };

// ── Validation + resolution ─────────────────────────────────────────────────

// Members are camelCase so they can never collide with PascalCase type names
// in the generated C++.
const MEMBER_NAME = /^[a-z][A-Za-z0-9_]*$/;
const TYPE_NAME = /^[A-Z][A-Za-z0-9]*$/;

/**
 * Words that cannot name a method, argument or field because they are reserved
 * in JavaScript or C++, or collide with names the generated code uses.
 */
const RESERVED_NAMES = new Set([
  // JavaScript
  'arguments',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'eval',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  // C++ (beyond the JavaScript list)
  'alignas',
  'alignof',
  'and',
  'asm',
  'auto',
  'bool',
  'char',
  'concept',
  'consteval',
  'constexpr',
  'constinit',
  'decltype',
  'double',
  'explicit',
  'extern',
  'float',
  'friend',
  'goto',
  'inline',
  'int',
  'long',
  'mutable',
  'namespace',
  'noexcept',
  'not',
  'nullptr',
  'operator',
  'or',
  'register',
  'requires',
  'short',
  'signed',
  'sizeof',
  'struct',
  'template',
  'thread_local',
  'typedef',
  'typename',
  'union',
  'unsigned',
  'using',
  'virtual',
  'volatile',
  'xor',
  // Generated code
  'promise',
  'install',
]);

/**
 * What `soundor:native` exports besides its methods (`events`), so no method
 * can take its name.
 */
const MODULE_EXPORTS = new Set(['events']);

/**
 * What an event cannot be called: the publisher class's own members in the
 * generated C++ (js::EventSource), and its namespace of values.
 */
const EVENT_RESERVED = new Set(['events', 'publish', 'statistics', 'hub']);

// Names a declared type cannot take: they would shadow what the generated
// TypeScript refers to.
const BUILTIN_TYPE_NAMES = new Set<string>([
  ...Object.values(BUFFER_ARRAY_TYPES),
  'ArrayBuffer',
  'BigInt',
  'Promise',
  'Array',
  'Object',
  'Error',
  'NativeEvent',
]);

type DeclarationKind = 'struct' | 'enum' | 'invalid';

/** Validates a `native` declaration and resolves it into a model. */
export function describeNativeApi(
  declaration: NativeApiDeclaration | undefined,
  basePath = 'native',
): NativeApiResult {
  const issues: NativeApiIssue[] = [];
  const typeDecls = declaration?.types ?? {};
  const methodDecls = declaration?.methods ?? {};
  const eventDecls = declaration?.events ?? {};

  const declaredKinds = new Map<string, DeclarationKind>();
  for (const [name, decl] of sortedEntries(typeDecls)) {
    const path = `${basePath}.types.${name}`;
    if (!TYPE_NAME.test(name)) {
      issues.push({
        path,
        message: `type name '${name}' must be PascalCase (letters and digits, starting uppercase)`,
      });
    } else if (BUILTIN_TYPE_NAMES.has(name)) {
      issues.push({
        path,
        message: `type name '${name}' collides with a built-in type`,
      });
    }
    declaredKinds.set(name, declarationKind(decl));
  }

  const resolve = (ref: unknown, path: string, allowVoid: boolean) =>
    resolveTypeRef(ref, path, allowVoid, declaredKinds, issues);

  const types: NativeTypeModel[] = [];
  for (const [name, decl] of sortedEntries(typeDecls)) {
    const path = `${basePath}.types.${name}`;
    if (isRecord(decl) && 'struct' in decl) {
      const fields = checkMembers(
        decl.struct,
        `${path}.struct`,
        'field',
        issues,
      ).map(([fieldName, ref]) => ({
        name: fieldName,
        type: resolve(ref, `${path}.struct.${fieldName}`, false),
      }));
      types.push({ kind: 'struct', name, fields });
    } else if (isRecord(decl) && 'enum' in decl) {
      types.push({
        kind: 'enum',
        name,
        values: checkEnumValues(decl.enum, `${path}.enum`, issues),
      });
    } else {
      issues.push({
        path,
        message:
          decl === 'handle'
            ? "'handle' types are gone: declare a { struct: { ... } } of the values the UI needs, or pass an ID or path"
            : 'expected { struct: { ... } } or { enum: [ ... ] }',
      });
    }
  }
  checkStructCycles(types, basePath, issues);

  const methods: NativeMethodModel[] = [];
  for (const [name, decl] of sortedEntries(methodDecls)) {
    const path = `${basePath}.methods.${name}`;
    checkMemberName(name, path, 'method', issues);
    if (MODULE_EXPORTS.has(name))
      issues.push({
        path,
        message: `method name '${name}' is taken by soundor:native's own '${name}' export`,
      });
    if (!isRecord(decl)) {
      issues.push({ path, message: 'expected { args?, returns?, async? }' });
      continue;
    }
    const args = checkMembers(
      decl.args ?? {},
      `${path}.args`,
      'argument',
      issues,
    ).map(([argName, ref]) => ({
      name: argName,
      type: resolve(ref, `${path}.args.${argName}`, false),
    }));
    const returns = resolve(decl.returns ?? 'void', `${path}.returns`, true);
    const isAsync = decl.async ?? false;
    if (typeof isAsync !== 'boolean') {
      issues.push({ path: `${path}.async`, message: 'expected a boolean' });
    }
    methods.push({ name, args, returns, async: isAsync === true });
  }

  if (!isRecord(eventDecls)) {
    issues.push({
      path: `${basePath}.events`,
      message: 'expected an object mapping event names to their fields',
    });
  }
  const events: NativeEventModel[] = [];
  for (const [name, decl] of isRecord(eventDecls)
    ? sortedEntries(eventDecls)
    : []) {
    const path = `${basePath}.events.${name}`;
    checkMemberName(name, path, 'event', issues);
    if (EVENT_RESERVED.has(name))
      issues.push({
        path,
        message: `event name '${name}' is taken by the generated C++ publisher`,
      });
    // Its value is the C++ struct events::<Name>, which would hide the type.
    const structName =
      name.length > 0 ? name[0]!.toUpperCase() + name.slice(1) : name;
    if (declaredKinds.has(structName))
      issues.push({
        path,
        message: `event '${name}' collides with the type '${structName}' (its value is the C++ struct events::${structName}); rename one of them`,
      });
    const fields = checkMembers(decl, path, 'field', issues).map(
      ([fieldName, ref]) => ({
        name: fieldName,
        type: resolve(ref, `${path}.${fieldName}`, false),
      }),
    );
    events.push({ name, fields });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, model: { types: orderStructs(types), methods, events } };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function declarationKind(decl: unknown): DeclarationKind {
  if (isRecord(decl) && 'struct' in decl) return 'struct';
  if (isRecord(decl) && 'enum' in decl) return 'enum';
  return 'invalid';
}

const BUFFER_REF = /^buffer<(.*)>$/;

function resolveTypeRef(
  ref: unknown,
  path: string,
  allowVoid: boolean,
  declared: ReadonlyMap<string, DeclarationKind>,
  issues: NativeApiIssue[],
): NativeType {
  if (typeof ref !== 'string') {
    issues.push({ path, message: 'expected a type name string' });
    return { kind: 'void' };
  }
  if (!ref.endsWith('?')) {
    return resolveValueRef(ref, path, allowVoid, declared, issues);
  }
  const inner = ref.slice(0, -1);
  if (inner.endsWith('?') || inner === 'void') {
    issues.push({
      path,
      message: `'${ref}' is not supported; '?' follows a value type once ('int32?', 'Preset?', 'float32[]?')`,
    });
    return { kind: 'void' };
  }
  return {
    kind: 'nullable',
    inner: resolveValueRef(inner, path, false, declared, issues),
  };
}

/** A type without a trailing `?`. */
function resolveValueRef(
  ref: string,
  path: string,
  allowVoid: boolean,
  declared: ReadonlyMap<string, DeclarationKind>,
  issues: NativeApiIssue[],
): NativeType {
  const buffer = BUFFER_REF.exec(ref);
  if (buffer !== null) {
    const element = buffer[1]!;
    if ((NUMERIC_TYPES as readonly string[]).includes(element)) {
      return { kind: 'buffer', element: element as NumericTypeName };
    }
    issues.push({
      path,
      message: `'${ref}' is not supported; a buffer holds one fixed-width numeric type: ${NUMERIC_TYPES.join(', ')}`,
    });
    return { kind: 'void' };
  }
  if (ref.endsWith('[]')) {
    const elementRef = ref.slice(0, -2);
    if (
      elementRef.endsWith('[]') ||
      elementRef.endsWith('?') ||
      BUFFER_REF.test(elementRef)
    ) {
      issues.push({
        path,
        message: `'${ref}' is not supported; an array holds primitives, enums or structs (wrap anything else in a struct)`,
      });
      return { kind: 'void' };
    }
    return {
      kind: 'array',
      element: resolveNamedRef(elementRef, path, false, declared, issues),
    };
  }
  return resolveNamedRef(ref, path, allowVoid, declared, issues);
}

/** Former names, and what to write instead. */
const REPLACED_TYPES: Readonly<Record<string, string>> = {
  number: "a sized number ('int32', 'float64', ...)",
  ArrayBuffer: "'buffer<uint8>'",
  ...Object.fromEntries(
    Object.entries(BUFFER_ARRAY_TYPES).map(([element, array]) => [
      array,
      `'buffer<${element}>'`,
    ]),
  ),
};

/** `void`, a primitive or a declared type. */
function resolveNamedRef(
  ref: string,
  path: string,
  allowVoid: boolean,
  declared: ReadonlyMap<string, DeclarationKind>,
  issues: NativeApiIssue[],
): NativeType {
  if (ref === 'void') {
    if (!allowVoid) {
      issues.push({ path, message: "'void' is only valid as a return type" });
    }
    return { kind: 'void' };
  }
  if ((PRIMITIVE_TYPES as readonly string[]).includes(ref)) {
    return { kind: 'primitive', name: ref as PrimitiveTypeName };
  }
  const declaration = declared.get(ref);
  if (declaration === 'struct' || declaration === 'enum') {
    return { kind: 'declared', name: ref, declaration };
  }
  if (declaration === 'invalid') return { kind: 'void' };
  const replacement = REPLACED_TYPES[ref];
  issues.push({
    path,
    message:
      replacement !== undefined
        ? `'${ref}' is not a native type; use ${replacement}`
        : `unknown type '${ref}'; use ${PRIMITIVE_TYPES.join(', ')}, a type declared in native.types, 'T[]', 'buffer<T>' or 'T?'`,
  });
  return { kind: 'void' };
}

function checkMembers(
  members: unknown,
  path: string,
  what: string,
  issues: NativeApiIssue[],
): [string, unknown][] {
  if (!isRecord(members)) {
    issues.push({
      path,
      message: `expected an object mapping ${what} names to types`,
    });
    return [];
  }
  // Insertion order is meaningful here: arguments are positional and fields
  // keep the author's order in the generated struct.
  const entries = Object.entries(members);
  for (const [name] of entries)
    checkMemberName(name, `${path}.${name}`, what, issues);
  return entries;
}

function checkMemberName(
  name: string,
  path: string,
  what: string,
  issues: NativeApiIssue[],
): void {
  if (!MEMBER_NAME.test(name)) {
    issues.push({
      path,
      message: `${what} name '${name}' must be camelCase (start with a lowercase letter; letters, digits and _)`,
    });
  } else if (RESERVED_NAMES.has(name)) {
    issues.push({
      path,
      message: `${what} name '${name}' is reserved in JavaScript, C++ or generated code`,
    });
  }
}

function checkEnumValues(
  values: unknown,
  path: string,
  issues: NativeApiIssue[],
): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    issues.push({ path, message: 'expected a non-empty array of strings' });
    return [];
  }
  const seen = new Map<string, string>();
  const result: string[] = [];
  values.forEach((value, index) => {
    if (typeof value !== 'string' || value.length === 0) {
      issues.push({
        path: `${path}[${index}]`,
        message: 'expected a non-empty string',
      });
      return;
    }
    const enumerator = enumeratorName(value);
    const clash = seen.get(enumerator);
    if (clash !== undefined) {
      issues.push({
        path: `${path}[${index}]`,
        message:
          clash === value
            ? `duplicate enum value '${value}'`
            : `enum values '${clash}' and '${value}' map to the same C++ enumerator '${enumerator}'`,
      });
      return;
    }
    seen.set(enumerator, value);
    result.push(value);
  });
  return result;
}

/** The C++ enumerator for an enum value: `'low-cut'` → `LowCut`. */
export function enumeratorName(value: string): string {
  const words = value.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0);
  const pascal = words
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join('');
  if (pascal.length === 0) return 'Value';
  return /^[0-9]/.test(pascal) ? `Value${pascal}` : pascal;
}

function checkStructCycles(
  types: readonly NativeTypeModel[],
  basePath: string,
  issues: NativeApiIssue[],
): void {
  const structs = new Map(
    types.flatMap((type) =>
      type.kind === 'struct' ? [[type.name, type] as const] : [],
    ),
  );
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (name: string, chain: string[]): void => {
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'visiting') {
      issues.push({
        path: `${basePath}.types.${name}`,
        message: `struct '${name}' contains itself (${[...chain, name].join(' → ')}); structs are values and cannot be recursive`,
      });
      return;
    }
    state.set(name, 'visiting');
    for (const dependency of structDependencies(structs.get(name)!)) {
      if (structs.has(dependency)) visit(dependency, [...chain, name]);
    }
    state.set(name, 'done');
  };
  for (const name of structs.keys()) visit(name, []);
}

function structDependencies(
  struct: Extract<NativeTypeModel, { kind: 'struct' }>,
): string[] {
  const names: string[] = [];
  const collect = (type: NativeType): void => {
    if (type.kind === 'array') collect(type.element);
    else if (type.kind === 'nullable') collect(type.inner);
    else if (type.kind === 'declared' && type.declaration === 'struct')
      names.push(type.name);
  };
  for (const field of struct.fields) collect(field.type);
  return names;
}

/** Enums first (sorted), then structs in dependency order. */
function orderStructs(types: readonly NativeTypeModel[]): NativeTypeModel[] {
  const others = types.filter((type) => type.kind !== 'struct');
  const structs = new Map(
    types.flatMap((type) =>
      type.kind === 'struct' ? [[type.name, type] as const] : [],
    ),
  );
  const ordered: NativeTypeModel[] = [];
  const placed = new Set<string>();
  const place = (name: string): void => {
    if (placed.has(name)) return;
    placed.add(name);
    const struct = structs.get(name)!;
    for (const dependency of structDependencies(struct)) place(dependency);
    ordered.push(struct);
  };
  for (const name of [...structs.keys()].sort()) place(name);
  return [...others, ...ordered];
}

function sortedEntries<T>(record: Readonly<Record<string, T>>): [string, T][] {
  return Object.entries(record).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

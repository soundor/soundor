/**
 * The typed native API a plugin declares under `native` in its config, and the
 * model every generator works from.
 *
 * Config authors write a compact, human-readable form:
 *
 * ```ts
 * native: {
 *   types: {
 *     Analysis: { struct: { rms: 'number', peak: 'number' } },
 *     Curve: { enum: ['linear', 'exponential'] },
 *     Preset: 'handle',
 *   },
 *   methods: {
 *     analyze: { args: { samples: 'Float32Array' }, returns: 'Analysis' },
 *     loadPreset: { args: { path: 'string' }, returns: 'Preset', async: true },
 *   },
 * }
 * ```
 *
 * {@link describeNativeApi} validates that form and resolves it into a
 * {@link NativeApiModel}: every type reference parsed, names sorted, so the
 * TypeScript declarations and the C++ bindings are generated from one
 * deterministic description.
 */

import { createHash } from 'node:crypto';

// ── Config form ──────────────────────────────────────────────────────────────

/**
 * A type reference: a primitive (`'number'`), a binary type (`'Float32Array'`),
 * a type declared under `native.types` (`'Preset'`), or a one-level array of a
 * non-binary type (`'string[]'`). `'void'` is only valid as a return type.
 */
export type NativeTypeRef = string;

/** A type declared under `native.types`. */
export type NativeTypeDeclaration =
  | 'handle'
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

/** The `native` section of a Soundor config. */
export interface NativeApiDeclaration {
  readonly types?: Readonly<Record<string, NativeTypeDeclaration>>;
  readonly methods?: Readonly<Record<string, NativeMethodDeclaration>>;
}

// ── Resolved model ──────────────────────────────────────────────────────────

export const PRIMITIVE_TYPES = ['boolean', 'number', 'string'] as const;
export type PrimitiveTypeName = (typeof PRIMITIVE_TYPES)[number];

export const BINARY_TYPES = [
  'ArrayBuffer',
  'Uint8Array',
  'Int32Array',
  'Float32Array',
  'Float64Array',
] as const;
export type BinaryTypeName = (typeof BINARY_TYPES)[number];

export type NativeType =
  | { readonly kind: 'void' }
  | { readonly kind: 'primitive'; readonly name: PrimitiveTypeName }
  | { readonly kind: 'binary'; readonly name: BinaryTypeName }
  | {
      readonly kind: 'declared';
      readonly name: string;
      readonly declaration: 'struct' | 'enum' | 'handle';
    }
  | { readonly kind: 'array'; readonly element: NativeType };

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
    }
  | { readonly kind: 'handle'; readonly name: string };

export interface NativeMethodModel {
  readonly name: string;
  readonly args: readonly NativeField[];
  readonly returns: NativeType;
  readonly async: boolean;
}

export interface NativeApiModel {
  /** Declared types, ordered so every struct follows the structs it contains. */
  readonly types: readonly NativeTypeModel[];
  /** Methods sorted by name. */
  readonly methods: readonly NativeMethodModel[];
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

const BUILTIN_TYPE_NAMES = new Set<string>([
  'void',
  ...PRIMITIVE_TYPES,
  ...BINARY_TYPES,
  'Promise',
  'Array',
  'Object',
  'Error',
]);

/** Validates a `native` declaration and resolves it into a model. */
export function describeNativeApi(
  declaration: NativeApiDeclaration | undefined,
  basePath = 'native',
): NativeApiResult {
  const issues: NativeApiIssue[] = [];
  const typeDecls = declaration?.types ?? {};
  const methodDecls = declaration?.methods ?? {};

  const declaredKinds = new Map<string, 'struct' | 'enum' | 'handle'>();
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
    if (decl === 'handle') {
      types.push({ kind: 'handle', name });
    } else if (isRecord(decl) && 'struct' in decl) {
      const fields = checkMembers(
        decl.struct,
        `${path}.struct`,
        'field',
        issues,
      ).map(([fieldName, ref]) => ({
        name: fieldName,
        type: resolve(ref, `${path}.struct.${fieldName}`, false),
      }));
      for (const field of fields) {
        if (!isStructFieldType(field.type)) {
          issues.push({
            path: `${path}.struct.${field.name}`,
            message:
              'struct fields may be primitives, enums, structs or arrays of them; binary data and handles are passed as method arguments instead',
          });
        }
      }
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
        message: "expected 'handle', { struct: { ... } } or { enum: [ ... ] }",
      });
    }
  }
  checkStructCycles(types, basePath, issues);

  const methods: NativeMethodModel[] = [];
  for (const [name, decl] of sortedEntries(methodDecls)) {
    const path = `${basePath}.methods.${name}`;
    checkMemberName(name, path, 'method', issues);
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

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, model: { types: orderStructs(types), methods } };
}

/**
 * The C++ inline namespace that isolates one plugin's native symbols from every
 * other Soundor plugin in the same host process: `p_` plus the first 8 hex
 * digits of the SHA-256 of the plugin id. Deterministic across builds and
 * machines; never visible to JavaScript.
 */
export function nativeAbiNamespace(pluginId: string): string {
  const digest = createHash('sha256').update(pluginId, 'utf8').digest('hex');
  return `p_${digest.slice(0, 8)}`;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function declarationKind(decl: unknown): 'struct' | 'enum' | 'handle' {
  if (isRecord(decl) && 'struct' in decl) return 'struct';
  if (isRecord(decl) && 'enum' in decl) return 'enum';
  return 'handle';
}

function resolveTypeRef(
  ref: unknown,
  path: string,
  allowVoid: boolean,
  declared: ReadonlyMap<string, 'struct' | 'enum' | 'handle'>,
  issues: NativeApiIssue[],
): NativeType {
  const fallback: NativeType = { kind: 'void' };
  if (typeof ref !== 'string') {
    issues.push({ path, message: 'expected a type name string' });
    return fallback;
  }
  if (ref.endsWith('[]')) {
    const element = resolveTypeRef(
      ref.slice(0, -2),
      path,
      false,
      declared,
      issues,
    );
    if (element.kind === 'array' || element.kind === 'binary') {
      issues.push({
        path,
        message: `'${ref}' is not supported; arrays hold primitives, enums, structs or handles`,
      });
    }
    return { kind: 'array', element };
  }
  if (ref === 'void') {
    if (!allowVoid) {
      issues.push({ path, message: "'void' is only valid as a return type" });
    }
    return { kind: 'void' };
  }
  if ((PRIMITIVE_TYPES as readonly string[]).includes(ref)) {
    return { kind: 'primitive', name: ref as PrimitiveTypeName };
  }
  if ((BINARY_TYPES as readonly string[]).includes(ref)) {
    return { kind: 'binary', name: ref as BinaryTypeName };
  }
  const declaration = declared.get(ref);
  if (declaration !== undefined) {
    return { kind: 'declared', name: ref, declaration };
  }
  issues.push({
    path,
    message: `unknown type '${ref}'; use ${[...PRIMITIVE_TYPES, ...BINARY_TYPES].join(', ')}, a type declared in native.types, or an array of one ('T[]')`,
  });
  return fallback;
}

function isStructFieldType(type: NativeType): boolean {
  if (type.kind === 'array') return isStructFieldType(type.element);
  if (type.kind === 'primitive') return true;
  return type.kind === 'declared' && type.declaration !== 'handle';
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
    else if (type.kind === 'declared' && type.declaration === 'struct')
      names.push(type.name);
  };
  for (const field of struct.fields) collect(field.type);
  return names;
}

/** Enums and handles first (sorted), then structs in dependency order. */
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

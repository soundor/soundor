/**
 * Runs a plugin UI's source files in the browser: each file compiled from
 * TypeScript/JSX to a CommonJS module (the module form the native runtime
 * runs too), then evaluated with a `require` that serves the playground's
 * libraries and the project's other files. No bundler: a few files, compiled
 * in milliseconds.
 */

import { transform } from 'sucrase';

/** Source files by path from the project root (`src/main.tsx`). */
export type SourceFiles = Readonly<Record<string, string>>;

/** A problem in the code, located when the compiler can say where. */
export class CodeError extends Error {
  override name = 'CodeError';
  constructor(
    message: string,
    readonly file?: string,
    readonly line?: number,
    readonly column?: number,
  ) {
    super(message);
  }

  /** The error as a compiler would print it: `src/App.tsx:3:7: message`. */
  get located(): string {
    if (this.file === undefined) return this.message;
    const at =
      this.line === undefined
        ? this.file
        : `${this.file}:${this.line}:${(this.column ?? 0) + 1}`;
    return `${at}: ${this.message}`;
  }
}

const EXTENSIONS = ['', '.tsx', '.ts', '.jsx', '.js'];

/** The file `specifier` names from `from`, if the project has it. */
function resolveFile(
  files: SourceFiles,
  from: string,
  specifier: string,
): string | undefined {
  const parts = from.split('/').slice(0, -1);
  for (const part of specifier.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.' && part !== '') parts.push(part);
  }
  const base = parts.join('/');
  for (const candidate of [
    ...EXTENSIONS.map((extension) => base + extension),
    ...EXTENSIONS.slice(1).map((extension) => `${base}/index${extension}`),
  ]) {
    if (Object.hasOwn(files, candidate)) return candidate;
  }
  return undefined;
}

/** Compiles one file to CommonJS. */
export function compile(path: string, code: string): string {
  try {
    return transform(code, {
      transforms: ['typescript', 'jsx', 'imports'],
      jsxRuntime: 'automatic',
      production: true,
      filePath: path,
    }).code;
  } catch (error) {
    // Sucrase's messages end with "(line:column)"; its errors carry `loc`.
    const loc = (error as { loc?: { line: number; column: number } }).loc;
    const message = (error instanceof Error ? error.message : String(error))
      .replace(/^Error transforming [^:]+: /, '')
      .replace(/\s*\(\d+:\d+\)$/, '');
    throw new CodeError(message, path, loc?.line, loc?.column);
  }
}

/**
 * Evaluates `entry` and what it imports. `libraries` are what code may
 * import besides its own files (`react`, `@soundor/react`, `soundor:*`).
 * Returns the entry's exports.
 */
export function run(
  files: SourceFiles,
  entry: string,
  libraries: Readonly<Record<string, unknown>>,
): unknown {
  if (!Object.hasOwn(files, entry)) {
    throw new CodeError(`There is no ${entry} to run`);
  }
  const modules = new Map<string, { exports: unknown }>();

  const load = (path: string): unknown => {
    const cached = modules.get(path);
    if (cached !== undefined) return cached.exports;
    const module = { exports: {} as unknown };
    modules.set(path, module);
    const code = compile(path, files[path]!);
    const require = (specifier: string): unknown => {
      if (specifier.startsWith('.')) {
        const file = resolveFile(files, path, specifier);
        if (file === undefined) {
          throw new CodeError(`Cannot find '${specifier}'`, path);
        }
        return load(file);
      }
      if (Object.hasOwn(libraries, specifier)) return libraries[specifier];
      throw new CodeError(
        `'${specifier}' is not available here: the playground provides ${Object.keys(
          libraries,
        )
          .sort()
          .join(', ')}`,
        path,
      );
    };
    // The module function, as the native runtime's module form has it. The
    // sourceURL names the file in stack traces and the browser's devtools.
    // oxlint-disable-next-line no-new-func
    const evaluate = new Function(
      'require',
      'module',
      'exports',
      `${code}\n//# sourceURL=playground:///${path}`,
    ) as (
      require: (specifier: string) => unknown,
      module: { exports: unknown },
      exports: unknown,
    ) => void;
    evaluate(require, module, module.exports);
    return module.exports;
  };

  return load(entry);
}

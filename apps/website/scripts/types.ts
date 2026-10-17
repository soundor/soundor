/**
 * The types an example's code is checked against, for the editor's language
 * service: every declaration file and `package.json` TypeScript reads to
 * check the example's `tsconfig.app.json` (TypeScript's own libraries, the
 * `soundor:*` declarations in `.soundor/generated`, React's and
 * `@soundor/react`'s types), so the editor knows exactly what `tsc` does.
 */

import { dirname, join, relative, sep } from 'node:path';

import ts from 'typescript-6';

import type { ExampleTypes } from '../src/editor/language-service.ts';

/** Where the editor's language service finds TypeScript's own libraries. */
export const LIB_DIR = '/node_modules/typescript/lib';

/** Options that only matter to a build, not to checking code in an editor. */
const BUILD_OPTIONS = [
  'composite',
  'configFilePath',
  'incremental',
  'noEmit',
  'tsBuildInfoFile',
] as const;

/** The types the example in `dir` is checked against. */
export function exampleTypes(dir: string): ExampleTypes {
  const configFile = join(dir, 'tsconfig.app.json');
  const config = ts.getParsedCommandLineOfConfigFile(
    configFile,
    // Paths stay inside the example: pnpm links packages from elsewhere.
    { preserveSymlinks: true },
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(
          ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        );
      },
    },
  );
  if (config === undefined) throw new Error(`${configFile} did not load`);
  if (config.errors.length > 0) {
    throw new Error(
      config.errors
        .map((error) =>
          ts.flattenDiagnosticMessageText(error.messageText, '\n'),
        )
        .join('\n'),
    );
  }

  const libDir = dirname(ts.getDefaultLibFilePath(config.options));
  const virtual = (file: string): string | null => {
    const fromLib = relative(libDir, file);
    if (!fromLib.startsWith('..'))
      return `${LIB_DIR}/${fromLib.split(sep).join('/')}`;
    const fromExample = relative(dir, file);
    if (!fromExample.startsWith('..'))
      return `/${fromExample.split(sep).join('/')}`;
    return null;
  };

  // What the check reads, recorded: the language service reads the same.
  const files: Record<string, string> = {};
  const host = ts.createCompilerHost(config.options);
  const readFile = host.readFile.bind(host);
  host.readFile = (file) => {
    const text = readFile(file);
    const path = virtual(file);
    // Outside: a package's real path, read only for its peer dependencies.
    if (text !== undefined && path !== null) files[path] = text;
    return text;
  };
  const program = ts.createProgram(config.fileNames, config.options, host);
  // The program also reads the source files: the editor has its own copies.
  for (const file of program.getSourceFiles()) {
    const path = virtual(file.fileName);
    if (path === null) {
      throw new Error(
        `${file.fileName} is outside ${dir}: the editor cannot have it`,
      );
    }
    if (!file.isDeclarationFile) delete files[path];
  }

  const options: Record<string, unknown> = { ...config.options };
  for (const option of BUILD_OPTIONS) delete options[option];
  return {
    options,
    roots: config.fileNames
      .filter((file) => file.endsWith('.d.ts'))
      .map((file) => virtual(file) ?? file),
    files: Object.fromEntries(
      Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

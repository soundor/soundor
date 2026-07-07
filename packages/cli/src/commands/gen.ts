import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';

import { outro, spinner } from '@clack/prompts';
import {
  parseConfig,
  resolveRuntime,
  runPhase,
  type RuntimeMode,
} from '@soundor/config';
import {
  checkGeneratedFiles,
  createCodegenSink,
  createConsoleLogger,
  createNodeFileSystem,
  createProjectPaths,
  generateSoundorFiles,
  rootFromConfigPath,
  SoundorError,
  UnknownRuntimeError,
  writeGeneratedFiles,
  type CodegenFile,
  type FileSystemHost,
} from '@soundor/core';
import { defineCommand } from 'citty';

const CONFIG_FILENAME = 'soundor.config.ts';

export interface RunGenOptions {
  cwd?: string;
  configPath?: string;
  check?: boolean;
  mode?: RuntimeMode;
  runtimeIds?: readonly string[];
}

export type RunGenFileStatus =
  | 'created'
  | 'updated'
  | 'unchanged'
  | 'up-to-date';

export interface RunGenFileReport {
  readonly path: string;
  readonly status: RunGenFileStatus;
}

export interface RunGenGroupReport {
  readonly name: string;
  readonly outputDir: string;
  readonly files: RunGenFileReport[];
}

export interface RunGenReport {
  readonly mode: 'write' | 'check';
  readonly groups: RunGenGroupReport[];
}

export async function runGen(
  options: RunGenOptions = {},
): Promise<RunGenReport> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = resolveConfigPath(cwd, options.configPath);
  const root = rootFromConfigPath(configPath);
  const config = await parseConfig({ path: configPath });
  const fs = createNodeFileSystem(root);
  const logger = createConsoleLogger('soundor');
  const portableDir = fs.resolve('.soundor', 'generated');
  const portableFiles = generateSoundorFiles(config);
  const runtimeEntries = selectRuntimeEntries(
    config.runtimes,
    options.runtimeIds,
  );
  const groups: RunGenGroupReport[] = [];

  if (options.check === true) {
    await checkGeneratedFiles(fs, portableDir, portableFiles);
    groups.push({
      name: 'core',
      outputDir: portableDir,
      files: checkReport(portableFiles),
    });
  } else {
    const files = await writeReport(fs, portableDir, portableFiles);
    await writeGeneratedFiles(fs, portableDir, portableFiles);
    groups.push({
      name: 'core',
      outputDir: portableDir,
      files,
    });
  }

  for (const runtimeEntry of runtimeEntries) {
    const resolved = resolveRuntime(config, runtimeEntry.id);
    const codegen = createCodegenSink();
    const paths = createProjectPaths({
      root,
      config: configPath,
      runtimeId: runtimeEntry.id,
    });

    await runPhase(resolved, 'gen', config, {
      paths,
      fs,
      logger: logger.child(runtimeEntry.id),
      codegen,
      mode: options.mode,
    });

    if (options.check === true) {
      await checkGeneratedFiles(fs, paths.gen, codegen.files());
      groups.push({
        name: `runtime:${runtimeEntry.id}`,
        outputDir: paths.gen,
        files: checkReport(codegen.files()),
      });
    } else {
      const files = await writeReport(fs, paths.gen, codegen.files());
      await writeGeneratedFiles(fs, paths.gen, codegen.files());
      groups.push({
        name: `runtime:${runtimeEntry.id}`,
        outputDir: paths.gen,
        files,
      });
    }
  }

  return { mode: options.check === true ? 'check' : 'write', groups };
}

function selectRuntimeEntries<T extends { readonly id: string }>(
  entries: readonly T[],
  runtimeIds?: readonly string[],
): T[] {
  if (runtimeIds === undefined) return [...entries];

  return runtimeIds.map((id) => {
    const entry = entries.find((runtime) => runtime.id === id);
    if (entry === undefined)
      throw new UnknownRuntimeError(
        id,
        entries.map((runtime) => runtime.id),
      );
    return entry;
  });
}

export const genCommand = defineCommand({
  meta: {
    name: 'gen',
    description: 'Generate derived files from configuration',
  },
  args: {
    check: {
      type: 'boolean',
      description: 'Assert generated files are up to date without writing',
    },
    config: {
      type: 'string',
      description: 'Path to soundor.config.ts',
    },
  },
  async run({ args }) {
    const s = spinner();
    const check = args['check'] === true;
    s.start(check ? 'Checking generated files' : 'Generating files');
    const report = await runGen({
      configPath:
        typeof args['config'] === 'string' ? args['config'] : undefined,
      check,
    });
    s.stop(check ? 'Generated files are up to date' : 'Files generated');
    outro(formatRunGenReport(report));
  },
});

export function formatRunGenReport(report: RunGenReport): string {
  const heading =
    report.mode === 'check' ? 'Checked generated files' : 'Generated files';
  const lines = [heading];
  for (const group of report.groups) {
    lines.push(`${group.name} -> ${group.outputDir}`);
    if (group.files.length === 0) {
      lines.push('  no files');
      continue;
    }
    for (const file of group.files) lines.push(`  ${file.status} ${file.path}`);
  }
  return lines.join('\n');
}

async function writeReport(
  fs: FileSystemHost,
  outputDir: string,
  files: readonly CodegenFile[],
): Promise<RunGenFileReport[]> {
  const results: RunGenFileReport[] = [];
  for (const file of sortFiles(files)) {
    const target = generatedTarget(fs, outputDir, file.path);
    const exists = await fs.exists(target);
    const status = !exists
      ? 'created'
      : (await fs.read(target)) === file.contents
        ? 'unchanged'
        : 'updated';
    results.push({ path: file.path, status });
  }
  return results;
}

function checkReport(files: readonly CodegenFile[]): RunGenFileReport[] {
  return sortFiles(files).map((file) => ({
    path: file.path,
    status: 'up-to-date',
  }));
}

function sortFiles(files: readonly CodegenFile[]): CodegenFile[] {
  return [...files].sort((a, b) => a.path.localeCompare(b.path));
}

function generatedTarget(
  fs: FileSystemHost,
  outputDir: string,
  filePath: string,
): string {
  if (filePath.startsWith('/') || filePath.includes('\\')) {
    throw new SoundorError(`Unsafe generated file path: ${filePath}`, {
      code: 'INTERNAL',
    });
  }

  const base = fs.resolve(outputDir);
  const target = resolve(base, filePath);
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw new SoundorError(`Unsafe generated file path: ${filePath}`, {
      code: 'INTERNAL',
    });
  }
  return target;
}

function resolveConfigPath(cwd: string, configPath?: string): string {
  if (configPath === undefined) return locateConfig(cwd);
  return isAbsolute(configPath) ? configPath : resolve(cwd, configPath);
}

function locateConfig(cwd: string): string {
  let dir = resolve(cwd);
  for (;;) {
    const candidate = resolve(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not find ${CONFIG_FILENAME} in ${resolve(cwd)} or any parent directory.`,
  );
}

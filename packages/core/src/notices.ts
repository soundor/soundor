/**
 * Third-party notices: what a built plugin contains that comes with a
 * license asking for its notice to go with copies, and the files that say so.
 *
 * Runtimes gather them from what their build actually contains:
 *
 * - npm packages, from the files a bundle kept after tree shaking
 *   ({@link javascriptNotices}): each file takes the license file nearest to
 *   it in its package, so a font next to its `OFL.txt` gets the OFL and the
 *   package's code its root `LICENSE`;
 * - Rust crates linked for a target, from Cargo's resolve
 *   ({@link crateNotices}), and Rust's standard library ({@link rustStdNotice});
 * - prebuilt parts that carry their own notices, such as an engine archive's
 *   `licenses/` ({@link directoryNotices});
 * - what the project's config adds ({@link addedNotices}).
 *
 * Then {@link writeNotices} lays them out in a build's `licenses/`: a folder
 * per component with its files as they are, `THIRD-PARTY-NOTICES.txt` with
 * every text, and `licenses.json` for tools.
 *
 * A component whose license text cannot be found fails the build
 * ({@link LicenseNoticeError}), naming the config that supplies it.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

import { SoundorError, type SoundorIssue } from './errors';

/** One file of a component's notice. */
export interface NoticeFile {
  /** Its path inside the component's folder, `/`-separated. */
  readonly path: string;
  /** The file it is copied from (absolute). */
  readonly source: string;
}

/** Where a notice came from. */
export type NoticeOrigin = 'found' | 'override' | 'added' | 'excluded';

/** A component of a build, and its license files. */
export interface Notice {
  /**
   * The group it is listed under, and the top folder of `licenses/`:
   * `engine`, `javascript`, `rust`, `project`, or a runtime's own (`vst3-sdk`).
   */
  readonly section: string;
  readonly name: string;
  readonly version?: string;
  /** Its license, as an SPDX expression, when known. */
  readonly license?: string;
  readonly origin: NoticeOrigin;
  /** Its folder in `licenses/`, `/`-separated, such as `javascript/react@19.2.0`. */
  readonly directory: string;
  readonly files: readonly NoticeFile[];
}

/** A license the config gives a package or crate, replacing the one found. */
export interface LicenseOverride {
  /** An SPDX expression. */
  readonly license: string;
  /** The license text (absolute). */
  readonly file: string;
}

/** A notice the config adds for something the build cannot see. */
export interface AddedLicense {
  readonly name: string;
  /** An SPDX expression. */
  readonly license: string;
  /** The license text (absolute). */
  readonly file: string;
}

/**
 * The config's `licenses`, with its files resolved: notices to add, and
 * overrides by package or crate name (`false`: ship no notice for it).
 */
export interface ResolvedLicenses {
  readonly add: readonly AddedLicense[];
  readonly packages: Readonly<Record<string, LicenseOverride | false>>;
  readonly crates: Readonly<Record<string, LicenseOverride | false>>;
}

/** No added notices and no overrides. */
export const NO_LICENSES: ResolvedLicenses = {
  add: [],
  packages: {},
  crates: {},
};

/** A build's components without a license text, all at once. */
export class LicenseNoticeError extends SoundorError {
  constructor(issues: readonly SoundorIssue[]) {
    super(
      [
        `${issues.length === 1 ? 'A component' : `${issues.length} components`} of the build ${issues.length === 1 ? 'has' : 'have'} no license text to ship with it:`,
        ...issues.map((issue) => `  ${issue.path}: ${issue.message}`),
        'Give each one in soundor.config.ts, for example:',
        "  licenses: { packages: { 'some-package': { license: 'MIT', file: './licenses/some-package.txt' } } }",
        'or `false` for a package of your own that needs none. See https://soundor.dev/docs/licenses.',
      ].join('\n'),
      { code: 'CONFIG', issues: [...issues] },
    );
    this.name = 'LicenseNoticeError';
  }
}

/**
 * Whether a file name is a license or notice file: `LICENSE`, `LICENSE.md`,
 * `LICENSE-MIT`, `LICENCE.txt`, `COPYING`, `NOTICE`, `OFL.txt`,
 * `THIRD_PARTY_NOTICES.md` and the like, never a source file.
 */
export function isLicenseFile(name: string): boolean {
  if (/\.(?:[cm]?[jt]sx?|json|map|d\.[cm]?ts)$/i.test(name)) return false;
  return /^(?:licen[cs]e|copying|copyright|notice|ofl|third[-_ ]party[-_ ]notices?)(?:$|[-_.])/i.test(
    name,
  );
}

/** The license files directly in `directory`, sorted. */
function licenseFilesIn(directory: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }
  return entries
    .filter((name) => isLicenseFile(name))
    .filter((name) => {
      try {
        return statSync(join(directory, name)).isFile();
      } catch {
        return false;
      }
    })
    .sort()
    .map((name) => join(directory, name));
}

/**
 * The license files nearest to `file`: those of its own folder or, without
 * any, of the closest folder above it, up to `top` (included).
 */
function nearestLicenseFiles(file: string, top: string): string[] {
  for (let directory = dirname(file); ;) {
    const found = licenseFilesIn(directory);
    if (found.length > 0) return found;
    if (directory === top || !isInside(directory, top)) return [];
    const parent = dirname(directory);
    if (parent === directory) return [];
    directory = parent;
  }
}

function isInside(path: string, directory: string): boolean {
  const rel = relative(directory, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function posix(path: string): string {
  return path.split(sep).join('/');
}

interface PackageInfo {
  readonly root: string;
  readonly name: string;
  readonly version?: string;
  readonly license?: string;
}

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function packageLicense(manifest: Record<string, unknown>): string | undefined {
  const license = manifest['license'];
  if (typeof license === 'string') return license;
  if (
    typeof license === 'object' &&
    license !== null &&
    typeof (license as { type?: unknown }).type === 'string'
  )
    return (license as { type: string }).type;
  return undefined;
}

/**
 * The package `file` belongs to. In `node_modules`, the folder right below
 * the last `node_modules` (a package's own nested `package.json`, such as
 * `preact/hooks`'s, is part of it); elsewhere (a workspace package, the
 * project) the nearest folder whose `package.json` has a name.
 */
function packageOf(file: string): PackageInfo | undefined {
  const parts = file.split(sep);
  const last = parts.lastIndexOf('node_modules');
  let root: string | undefined;
  if (last !== -1 && last + 1 < parts.length) {
    const scoped = parts[last + 1]!.startsWith('@');
    root = parts.slice(0, last + (scoped ? 3 : 2)).join(sep);
  } else {
    for (let directory = dirname(file); ;) {
      const manifest = readJson(join(directory, 'package.json'));
      if (typeof manifest?.['name'] === 'string') {
        root = directory;
        break;
      }
      const parent = dirname(directory);
      if (parent === directory) return undefined;
      directory = parent;
    }
  }
  const manifest = readJson(join(root, 'package.json'));
  if (manifest === undefined || typeof manifest['name'] !== 'string')
    return undefined;
  const version = manifest['version'];
  const license = packageLicense(manifest);
  return {
    root,
    name: manifest['name'],
    ...(typeof version === 'string' ? { version } : {}),
    ...(license === undefined ? {} : { license }),
  };
}

/**
 * The root of the pnpm workspace `directory` is in, if any: `pnpm publish`
 * adds the workspace root's `LICENSE` to a package that has none, so a
 * workspace package's notice is that one.
 */
function pnpmWorkspaceRoot(directory: string): string | undefined {
  if (directory.split(sep).includes('node_modules')) return undefined;
  for (let current = directory; ;) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function componentDirectory(
  section: string,
  name: string,
  version?: string,
): string {
  return `${section}/${version === undefined ? name : `${name}@${version}`}`;
}

/** The notice an override or an exclusion makes. */
function overriddenNotice(
  section: string,
  name: string,
  version: string | undefined,
  override: LicenseOverride | false,
): Notice {
  const directory = componentDirectory(section, name, version);
  if (override === false)
    return {
      section,
      name,
      ...(version === undefined ? {} : { version }),
      origin: 'excluded',
      directory,
      files: [],
    };
  return {
    section,
    name,
    ...(version === undefined ? {} : { version }),
    license: override.license,
    origin: 'override',
    directory,
    files: [{ path: basename(override.file), source: override.file }],
  };
}

/** What a collector found, and the problems it could not resolve. */
export interface NoticeCollection {
  readonly notices: readonly Notice[];
  /** Components without a license text, for {@link LicenseNoticeError}. */
  readonly issues: readonly SoundorIssue[];
  /** Overrides that matched nothing in the build, by config path. */
  readonly unused: readonly string[];
}

export interface JavascriptNoticesOptions {
  /** The project root: its own files have no notice but the ones beside them. */
  readonly root: string;
  readonly licenses?: ResolvedLicenses;
}

/**
 * The notices of npm packages and project files in a bundle, from the files
 * it contains (absolute paths; virtual modules are ignored).
 *
 * A package's file takes the license files nearest to it in the package; a
 * package with none takes, in a pnpm workspace, the workspace root's (as
 * `pnpm publish` does). A project file takes the license files nearest to it
 * below the project root, never the root's own (the plugin's license), and
 * none if there are none: it is the project's code.
 */
export function javascriptNotices(
  files: Iterable<string>,
  options: JavascriptNoticesOptions,
): NoticeCollection {
  const root = resolve(options.root);
  const licenses = options.licenses ?? NO_LICENSES;
  const packages = new Map<
    string,
    { info: PackageInfo; files: Set<string>; missing: string[] }
  >();
  const project = new Map<string, Set<string>>();

  for (const id of files) {
    const file = id.split('?')[0]!;
    if (file.startsWith('\0') || !isAbsolute(file)) continue;
    // The project's own file, whatever package.json is above the project
    // (a project inside a package, as a package's test fixture is).
    if (
      isInside(file, root) &&
      !relative(root, file).split(sep).includes('node_modules')
    ) {
      const found = nearestLicenseFiles(file, root).filter(
        (license) => dirname(license) !== root,
      );
      if (found.length === 0) continue;
      const directory = dirname(found[0]!);
      const entry = project.get(directory) ?? new Set<string>();
      for (const license of found) entry.add(license);
      project.set(directory, entry);
      continue;
    }
    const info = packageOf(file);
    if (info === undefined) continue;
    const key = `${info.name}@${info.version ?? ''}`;
    const entry = packages.get(key) ?? {
      info,
      files: new Set<string>(),
      missing: [],
    };
    packages.set(key, entry);
    let found = nearestLicenseFiles(file, info.root);
    if (found.length === 0) {
      const workspace = pnpmWorkspaceRoot(info.root);
      if (workspace !== undefined) found = licenseFilesIn(workspace);
    }
    if (found.length === 0) entry.missing.push(file);
    for (const license of found) entry.files.add(license);
  }

  const notices: Notice[] = [];
  const issues: SoundorIssue[] = [];
  const used = new Set<string>();
  for (const { info, files: found, missing } of [...packages.values()].sort(
    (a, b) =>
      a.info.name.localeCompare(b.info.name) ||
      (a.info.version ?? '').localeCompare(b.info.version ?? ''),
  )) {
    const override = licenses.packages[info.name];
    if (override !== undefined) {
      used.add(info.name);
      notices.push(
        overriddenNotice('javascript', info.name, info.version, override),
      );
      continue;
    }
    if (missing.length > 0 && found.size === 0) {
      issues.push({
        path: `licenses.packages.${info.name}`,
        message: `${info.name}${info.version === undefined ? '' : ` ${info.version}`} (${info.license ?? 'no license declared'}) ships no license file (${posix(relative(root, info.root))})`,
      });
      continue;
    }
    notices.push({
      section: 'javascript',
      name: info.name,
      ...(info.version === undefined ? {} : { version: info.version }),
      ...(info.license === undefined ? {} : { license: info.license }),
      origin: 'found',
      directory: componentDirectory('javascript', info.name, info.version),
      files: noticeFiles([...found], info.root),
    });
  }
  for (const [directory, found] of [...project].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const name = posix(relative(root, directory));
    notices.push({
      section: 'project',
      name,
      origin: 'found',
      directory: `project/${name}`,
      files: noticeFiles([...found], directory),
    });
  }
  return {
    notices,
    issues,
    unused: Object.keys(licenses.packages)
      .filter((name) => !used.has(name))
      .map((name) => `licenses.packages.${name}`),
  };
}

/**
 * The files of a notice, by their path relative to `base` (a license file
 * deeper in a package keeps its folders: `assets/geist/OFL.txt`).
 */
function noticeFiles(files: readonly string[], base: string): NoticeFile[] {
  return [...new Set(files)]
    .map((source) => {
      const inside = isInside(source, base);
      return {
        path: inside ? posix(relative(base, source)) : basename(source),
        source,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** What runs `cargo metadata` and `rustc`; injectable for tests. */
export type RunTool = (
  command: string,
  args: readonly string[],
  cwd: string,
) => { status: number | null; stdout: string; stderr: string };

const runTool: RunTool = (command, args, cwd) => {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error !== undefined)
    return { status: null, stdout: '', stderr: result.error.message };
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

interface CargoMetadata {
  packages: {
    id: string;
    name: string;
    version: string;
    license: string | null;
    license_file: string | null;
    manifest_path: string;
    targets: { kind: string[] }[];
  }[];
  resolve: {
    root: string | null;
    nodes: {
      id: string;
      deps: { pkg: string; dep_kinds: { kind: string | null }[] }[];
    }[];
  } | null;
}

export interface CrateNoticesOptions {
  /** The crate whose library the build links: its `Cargo.toml`. */
  readonly manifest: string;
  /** The Rust target triple it is compiled for. */
  readonly target: string;
  /** Where Cargo runs (the project: its `rust-toolchain.toml` applies). */
  readonly cwd: string;
  /**
   * Manifests of crates that are the project's own or generated for it
   * (`Cargo.toml` paths): no notice of their own.
   */
  readonly exclude?: readonly string[];
  readonly licenses?: ResolvedLicenses;
  readonly run?: RunTool;
}

/**
 * The notices of the crates `manifest`'s library links for `target`: its
 * normal dependencies, transitively, as Cargo resolves them for that
 * platform. Build and dev dependencies, and procedural macros, run while
 * compiling and are not in the binary.
 */
export function crateNotices(options: CrateNoticesOptions): NoticeCollection {
  const run = options.run ?? runTool;
  const licenses = options.licenses ?? NO_LICENSES;
  const result = run(
    'cargo',
    [
      'metadata',
      '--format-version',
      '1',
      '--manifest-path',
      options.manifest,
      '--filter-platform',
      options.target,
    ],
    options.cwd,
  );
  if (result.status !== 0)
    throw new SoundorError(
      `cargo metadata failed for ${options.manifest}: ${result.stderr.trim() || 'no output'}`,
      { code: 'ENV' },
    );
  const metadata = JSON.parse(result.stdout) as CargoMetadata;
  const byId = new Map(metadata.packages.map((entry) => [entry.id, entry]));
  const nodes = new Map(
    (metadata.resolve?.nodes ?? []).map((node) => [node.id, node]),
  );
  const rootId =
    metadata.resolve?.root ??
    metadata.packages.find(
      (entry) => resolve(entry.manifest_path) === resolve(options.manifest),
    )?.id;
  const excluded = new Set(
    [options.manifest, ...(options.exclude ?? [])].map((path) => resolve(path)),
  );

  const linked = new Set<string>();
  const queue = rootId === undefined ? [] : [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (linked.has(id)) continue;
    const entry = byId.get(id);
    if (entry === undefined) continue;
    if (entry.targets.some((target) => target.kind.includes('proc-macro')))
      continue;
    linked.add(id);
    for (const dep of nodes.get(id)?.deps ?? [])
      if (dep.dep_kinds.some((kind) => kind.kind === null)) queue.push(dep.pkg);
  }

  const notices: Notice[] = [];
  const issues: SoundorIssue[] = [];
  const used = new Set<string>();
  for (const entry of [...linked]
    .map((id) => byId.get(id)!)
    .filter((entry) => !excluded.has(resolve(entry.manifest_path)))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
    )) {
    const override = licenses.crates[entry.name];
    if (override !== undefined) {
      used.add(entry.name);
      notices.push(
        overriddenNotice('rust', entry.name, entry.version, override),
      );
      continue;
    }
    const directory = dirname(entry.manifest_path);
    const files = [
      ...(entry.license_file === null
        ? []
        : [resolve(directory, entry.license_file)].filter((file) =>
            existsSync(file),
          )),
      ...licenseFilesIn(directory),
    ];
    if (files.length === 0) {
      const workspace = pnpmWorkspaceRoot(directory);
      if (workspace !== undefined) files.push(...licenseFilesIn(workspace));
    }
    if (files.length === 0) {
      issues.push({
        path: `licenses.crates.${entry.name}`,
        message: `${entry.name} ${entry.version} (${entry.license ?? 'no license declared'}) ships no license file (${directory})`,
      });
      continue;
    }
    notices.push({
      section: 'rust',
      name: entry.name,
      version: entry.version,
      ...(entry.license === null ? {} : { license: entry.license }),
      origin: 'found',
      directory: componentDirectory('rust', entry.name, entry.version),
      files: noticeFiles(files, directory),
    });
  }
  return {
    notices,
    issues,
    unused: Object.keys(licenses.crates)
      .filter((name) => name !== 'std' && !used.has(name))
      .map((name) => `licenses.crates.${name}`),
  };
}

export interface RustStdNoticeOptions {
  /** Where rustc runs (the project: its `rust-toolchain.toml` applies). */
  readonly cwd: string;
  readonly licenses?: ResolvedLicenses;
  readonly run?: RunTool;
}

/**
 * The notice of Rust's standard library, which every Rust binary links:
 * `COPYRIGHT-library.html`, which the Rust project ships with its toolchain
 * (in `share/doc/rust`) for exactly this. `licenses.crates.std` replaces it.
 */
export function rustStdNotice(options: RustStdNoticeOptions): NoticeCollection {
  const run = options.run ?? runTool;
  const version = /^release: (\S+)$/m.exec(
    run('rustc', ['-vV'], options.cwd).stdout,
  )?.[1];
  const override = (options.licenses ?? NO_LICENSES).crates['std'];
  if (override !== undefined)
    return {
      notices: [overriddenNotice('rust', 'std', version, override)],
      issues: [],
      unused: [],
    };
  const sysroot = run(
    'rustc',
    ['--print', 'sysroot'],
    options.cwd,
  ).stdout.trim();
  const file = join(sysroot, 'share', 'doc', 'rust', 'COPYRIGHT-library.html');
  if (sysroot === '' || !existsSync(file))
    return {
      notices: [],
      issues: [
        {
          path: 'licenses.crates.std',
          message: `Rust's standard library: its notices (share/doc/rust/COPYRIGHT-library.html) are not in this toolchain${sysroot === '' ? '' : ` (${sysroot})`}; install Rust with rustup`,
        },
      ],
      unused: [],
    };
  return {
    notices: [
      {
        section: 'rust',
        name: 'std',
        ...(version === undefined ? {} : { version }),
        license: 'MIT OR Apache-2.0',
        origin: 'found',
        directory: componentDirectory('rust', 'std', version),
        files: [{ path: 'COPYRIGHT-library.html', source: file }],
      },
    ],
    issues: [],
    unused: [],
  };
}

function filesUnder(directory: string, base = directory): NoticeFile[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return filesUnder(path, base);
      return entry.isFile()
        ? [{ path: posix(relative(base, path)), source: path }]
        : [];
    });
}

/**
 * Notices a prebuilt part carries in a folder, as they are: each folder in
 * `directory` is a component, listed as `<section>/<name>`. Files directly
 * in it are one component named `name` (when given). A missing directory
 * has none.
 */
export function directoryNotices(
  section: string,
  directory: string,
  options: { name?: string } = {},
): Notice[] {
  if (!existsSync(directory)) return [];
  const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const notices: Notice[] = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      section,
      name: entry.name,
      origin: 'found' as const,
      directory: `${section}/${entry.name}`,
      files: filesUnder(join(directory, entry.name)),
    }));
  const loose = entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      path: entry.name,
      source: join(directory, entry.name),
    }));
  if (loose.length > 0)
    notices.unshift({
      section,
      name: options.name ?? section,
      origin: 'found',
      directory: section,
      files: loose,
    });
  return notices.filter((notice) => notice.files.length > 0);
}

/** The notices the config adds, under `project/`. */
export function addedNotices(licenses: ResolvedLicenses): Notice[] {
  return licenses.add.map((added) => ({
    section: 'project',
    name: added.name,
    license: added.license,
    origin: 'added',
    directory: `project/${added.name.replace(/[/\\\0]/g, '_')}`,
    files: [{ path: basename(added.file), source: added.file }],
  }));
}

/**
 * Throws {@link LicenseNoticeError} for every component without a text, and
 * returns the notices and the overrides that matched nothing. With
 * `onMissing`, a development build's, the problems go to it instead and the
 * notices found are returned: a missing text stops a release, never `dev`.
 */
export function settleNotices(
  collections: readonly NoticeCollection[],
  options: { onMissing?: (error: LicenseNoticeError) => void } = {},
): {
  notices: Notice[];
  unused: string[];
} {
  const issues = collections.flatMap((collection) => collection.issues);
  if (issues.length > 0) {
    const error = new LicenseNoticeError(issues);
    if (options.onMissing === undefined) throw error;
    options.onMissing(error);
  }
  return {
    notices: collections.flatMap((collection) => [...collection.notices]),
    unused: collections.flatMap((collection) => [...collection.unused]),
  };
}

const SECTION_ORDER = ['engine', 'javascript', 'rust', 'project'];

function sectionRank(section: string): number {
  const index = SECTION_ORDER.indexOf(section);
  // A runtime's own sections (vst3-sdk) come after the engine.
  return index === -1 ? 0.5 : index;
}

/** Notices in the order they are listed: by section, then folder. */
export function sortNotices(notices: readonly Notice[]): Notice[] {
  return [...notices].sort(
    (a, b) =>
      sectionRank(a.section) - sectionRank(b.section) ||
      a.section.localeCompare(b.section) ||
      a.directory.localeCompare(b.directory),
  );
}

/** `licenses.json`: what `licenses/` holds, for tools. */
export interface NoticeManifest {
  readonly format: 1;
  readonly components: readonly {
    readonly section: string;
    readonly name: string;
    readonly version?: string;
    readonly license?: string;
    readonly origin: NoticeOrigin;
    readonly directory: string;
    readonly files: readonly string[];
  }[];
}

/** The `licenses.json` of `notices`. */
export function noticeManifest(notices: readonly Notice[]): NoticeManifest {
  return {
    format: 1,
    components: sortNotices(notices).map((notice) => ({
      section: notice.section,
      name: notice.name,
      ...(notice.version === undefined ? {} : { version: notice.version }),
      ...(notice.license === undefined ? {} : { license: notice.license }),
      origin: notice.origin,
      directory: notice.directory,
      files: notice.files.map((file) => `${notice.directory}/${file.path}`),
    })),
  };
}

const RULE = '='.repeat(78);

/** Files read as text in `THIRD-PARTY-NOTICES.txt`; others are named. */
function isText(path: string): boolean {
  return !/\.(?:html?|pdf|png|jpe?g|gif|webp|svg)$/i.test(path);
}

/** One line naming a component: `react 19.2.0 (MIT)`. */
export function describeNotice(notice: Notice): string {
  return `${notice.name}${notice.version === undefined ? '' : ` ${notice.version}`}${notice.license === undefined ? '' : ` (${notice.license})`}`;
}

/** `THIRD-PARTY-NOTICES.txt`: every component and its license texts. */
export async function renderNoticesText(
  notices: readonly Notice[],
  title: string,
): Promise<string> {
  const shipped = sortNotices(notices).filter(
    (notice) => notice.origin !== 'excluded',
  );
  const lines = [
    `Third-party notices: ${title}`,
    '',
    'This software contains the components listed below. The license texts of',
    'each one follow, and are also in the folder of licenses/ named after it.',
    '',
    ...shipped.map(
      (notice) => `  ${notice.directory}  ${describeNotice(notice)}`,
    ),
    '',
  ];
  for (const notice of shipped) {
    lines.push(
      RULE,
      `${describeNotice(notice)}  [${notice.directory}]`,
      RULE,
      '',
    );
    for (const file of notice.files) {
      const path = `${notice.directory}/${file.path}`;
      if (!isText(file.path)) {
        lines.push(`(See ${path}.)`, '');
        continue;
      }
      if (notice.files.length > 1) lines.push(`--- ${path}`, '');
      lines.push((await readFile(file.source, 'utf8')).trimEnd(), '');
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * Writes `notices` into `directory` (replacing it): each component's files
 * in its folder, `THIRD-PARTY-NOTICES.txt` and `licenses.json`. Two
 * components never share a folder.
 */
export async function writeNotices(
  directory: string,
  notices: readonly Notice[],
  options: { title: string },
): Promise<void> {
  const seen = new Map<string, Notice>();
  for (const notice of notices) {
    const other = seen.get(notice.directory);
    if (other !== undefined && other !== notice)
      throw new SoundorError(
        `Two components of the build have the same notice folder, ${notice.directory}: ${describeNotice(other)} and ${describeNotice(notice)}`,
        { code: 'INTERNAL' },
      );
    seen.set(notice.directory, notice);
  }
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  for (const notice of notices)
    for (const file of notice.files) {
      const target = join(
        directory,
        ...notice.directory.split('/'),
        ...file.path.split('/'),
      );
      await mkdir(dirname(target), { recursive: true });
      await copyFile(file.source, target);
    }
  await writeFile(
    join(directory, 'THIRD-PARTY-NOTICES.txt'),
    await renderNoticesText(notices, options.title),
  );
  await writeFile(
    join(directory, 'licenses.json'),
    `${JSON.stringify(noticeManifest(notices), null, 2)}\n`,
  );
}

/**
 * A one-line summary of `notices`, for a build's log:
 * `31 components (MIT 24, ISC 3, OFL-1.1 1, …)`.
 */
export function summarizeNotices(notices: readonly Notice[]): string {
  const shipped = notices.filter((notice) => notice.origin !== 'excluded');
  const counts = new Map<string, number>();
  for (const notice of shipped) {
    // Prebuilt parts' notices say theirs in their texts.
    const license = notice.license ?? 'other';
    counts.set(license, (counts.get(license) ?? 0) + 1);
  }
  // The most common first; those whose texts alone say theirs last.
  const parts = [...counts]
    .sort(
      ([a, x], [b, y]) =>
        Number(a === 'other') - Number(b === 'other') ||
        y - x ||
        a.localeCompare(b),
    )
    .map(([license, count]) => `${license} ${count}`);
  return `${shipped.length} component${shipped.length === 1 ? '' : 's'}${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`;
}

/** The modules the UI bundle contains, in its directory (the CLI writes it). */
export const UI_MODULES_FILE = 'modules.json';

/**
 * The files the UI bundle in `dir` contains, after tree shaking (absolute
 * paths), from its `modules.json`; none for a bundle without it.
 */
export async function readUiModules(dir: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(
      await readFile(join(dir, UI_MODULES_FILE), 'utf8'),
    ) as { modules?: unknown };
    return Array.isArray(parsed.modules)
      ? parsed.modules.filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

/**
 * Logs what a build ships in `licenses/` (`where`), and warns of overrides
 * in the config that match nothing.
 */
export function logNotices(
  logger: { info(message: string): void; warn(message: string): void },
  report: {
    readonly notices: readonly Notice[];
    readonly unused: readonly string[];
  },
  where: string,
): void {
  logger.info(`Licenses: ${summarizeNotices(report.notices)} -> ${where}`);
  for (const path of report.unused)
    logger.warn(
      `${path} in soundor.config.ts matches nothing in the build: remove it if it is stale.`,
    );
}

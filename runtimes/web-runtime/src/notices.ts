/**
 * The third-party notices of a web build, in `<dist>/licenses/`:
 *
 *   engine/<component>/        what the engine's WebAssembly core contains
 *                              (the engine, Yoga, Emscripten's libc)
 *   javascript/<pkg>@<ver>/    npm packages in the plugin's UI bundle and in
 *                              the host page (this runtime, Preact...)
 *   rust/<crate>@<ver>/        crates compiled into the processor's module,
 *                              and Rust's std
 *   project/<name>/            files of the project with their own license,
 *                              and what the config adds
 *   THIRD-PARTY-NOTICES.txt    all of them, in one file
 *   licenses.json              the same, for tools
 *
 * The page serves them as they are: `licenses/THIRD-PARTY-NOTICES.txt` is
 * a link away from the host's own UI.
 */

import { basename } from 'node:path';

import {
  addedNotices,
  javascriptNotices,
  readUiModules,
  settleNotices,
  NO_LICENSES,
  type LibraryBuildContext,
  type LicensesReport,
  type Notice,
  type NoticeCollection,
  type ResolvedSoundorConfig,
  type UiBundleContext,
} from '@soundor/runtime-sdk';
import type { Plugin } from 'vite';

/** Collects the modules a Vite build renders code of, after tree shaking. */
export function modulesCollector(modules: Set<string>): Plugin {
  return {
    name: 'soundor:notices',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle))
        if (output.type === 'chunk')
          for (const [id, module] of Object.entries(output.modules))
            if (module.renderedLength > 0) modules.add(id.split('?')[0]!);
    },
  };
}

export interface WebNoticesInput {
  readonly config: ResolvedSoundorConfig;
  /** The project root. */
  readonly root: string;
  /** The modules of the host page Vite built. */
  readonly pageModules: Iterable<string>;
  /** The UI bundle, whose `modules.json` names its files. */
  readonly ui?: UiBundleContext;
  /** The project's crate, which the CLI resolves; none without one. */
  readonly lib?: LibraryBuildContext;
  /** The Rust target its module is compiled for. */
  readonly rustTarget: string;
  /** The engine module's notices, by component. */
  readonly engineLicenses: readonly {
    readonly name: string;
    readonly license?: string;
    readonly files: readonly string[];
  }[];
}

/** Everything a web build of the project contains that has a notice. */
export async function webNotices(
  input: WebNoticesInput,
): Promise<LicensesReport> {
  const licenses = input.config.licenses ?? NO_LICENSES;
  const engine: Notice[] = input.engineLicenses.map((component) => ({
    section: 'engine',
    name: component.name,
    ...(component.license === undefined ? {} : { license: component.license }),
    origin: 'found',
    directory: `engine/${component.name}`,
    files: component.files.map((file) => ({
      path: basename(file),
      source: file,
    })),
  }));
  const ui = input.ui === undefined ? [] : await readUiModules(input.ui.dir);
  const collections: NoticeCollection[] = [
    { notices: [...engine, ...addedNotices(licenses)], issues: [], unused: [] },
    javascriptNotices([...input.pageModules, ...ui], {
      root: input.root,
      licenses,
    }),
  ];
  if (input.lib !== undefined)
    collections.push(await input.lib.notices(input.rustTarget, licenses));
  return settleNotices(collections);
}

/**
 * The third-party notices of a VST3 plugin, in its bundle's
 * `Contents/Resources/licenses/`:
 *
 *   engine/<component>/        the prebuilt engine's own notices, as its
 *                              archive carries them (Skia, Hermes, ANGLE...)
 *   vst3-sdk/                  Steinberg's VST3 SDK, from the adapter
 *   javascript/<pkg>@<ver>/    npm packages in the UI's bytecode
 *   rust/<crate>@<ver>/        crates linked into the binary, and Rust's std
 *   project/<name>/            files of the project with their own license,
 *                              and what the config adds
 *   THIRD-PARTY-NOTICES.txt    all of them, in one file
 *   licenses.json              the same, for tools
 */

import { basename, join } from 'node:path';

import { loweredCodeNotices } from '@soundor/engine';
import {
  addedNotices,
  crateNotices,
  directoryNotices,
  javascriptNotices,
  readUiModules,
  rustStdNotice,
  settleNotices,
  NO_LICENSES,
  type LicensesReport,
  type NoticeCollection,
  type ResolvedSoundorConfig,
  type UiBundleContext,
} from '@soundor/runtime-sdk';

export interface Vst3NoticesInput {
  readonly config: ResolvedSoundorConfig;
  /** The project root. */
  readonly root: string;
  /** The extracted (or staged) engine, with its `licenses/`. */
  readonly engineDirectory: string;
  /** The adapter's directory, with its `licenses/vst3sdk/`. */
  readonly adapterDirectory: string;
  /** The UI bundle, whose `modules.json` names its files. */
  readonly ui?: UiBundleContext;
  /** The crate the runtime generates and Cargo builds: its `Cargo.toml`. */
  readonly crateManifest: string;
  /** The project's own crate, `lib/Cargo.toml`. */
  readonly libManifest: string;
  /** The Rust target triple. */
  readonly rustTarget: string;
  /**
   * This package's version: its `soundor-vst3` crate's, whose manifest says
   * 0.0.0 (it is never published on its own).
   */
  readonly runtimeVersion: string;
  /**
   * A development build's: told of components without a license text,
   * which otherwise fail the build.
   */
  readonly onMissing?: (error: Error) => void;
}

/** Everything a VST3 build of the project contains that has a notice. */
export async function vst3Notices(
  input: Vst3NoticesInput,
): Promise<LicensesReport> {
  const licenses = input.config.licenses ?? NO_LICENSES;
  const collections: NoticeCollection[] = [
    {
      notices: [
        ...directoryNotices('engine', join(input.engineDirectory, 'licenses')),
        ...directoryNotices(
          'vst3-sdk',
          join(input.adapterDirectory, 'licenses', 'vst3sdk'),
          { name: 'VST3 SDK' },
        ),
        ...addedNotices(licenses),
        // The engine's lowering inlines Babel's helpers into the UI's code.
        ...(input.ui === undefined
          ? []
          : loweredCodeNotices().map((component) => ({
              section: 'javascript',
              name: component.name,
              version: component.version,
              ...(component.license === undefined
                ? {}
                : { license: component.license }),
              origin: 'found' as const,
              directory: `javascript/${component.name}@${component.version}`,
              files: component.files.map((file) => ({
                path: basename(file),
                source: file,
              })),
            }))),
      ],
      issues: [],
      unused: [],
    },
    javascriptNotices(
      input.ui === undefined ? [] : await readUiModules(input.ui.dir),
      { root: input.root, licenses },
    ),
    crateNotices({
      manifest: input.crateManifest,
      target: input.rustTarget,
      cwd: input.root,
      exclude: [input.libManifest],
      licenses,
    }),
    rustStdNotice({ cwd: input.root, licenses }),
  ];
  const report = settleNotices(
    collections,
    input.onMissing === undefined ? {} : { onMissing: input.onMissing },
  );
  return {
    ...report,
    notices: report.notices.map((notice) =>
      notice.section === 'rust' && notice.name === 'soundor-vst3'
        ? {
            ...notice,
            version: input.runtimeVersion,
            directory: `rust/soundor-vst3@${input.runtimeVersion}`,
          }
        : notice,
    ),
  };
}

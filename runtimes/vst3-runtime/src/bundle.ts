/**
 * The VST3 bundle, as the VST3 specification lays it out:
 *
 *   <Name>.vst3/
 *     Contents/
 *       x86_64-linux/<Name>.so      Linux
 *       MacOS/<Name>                macOS, with Info.plist and PkgInfo
 *       x86_64-win/<Name>.vst3      Windows (a DLL)
 *       Resources/
 *         moduleinfo.json      the module's classes, for hosts that scan without loading
 *         licenses/            the notices of what the binary contains (notices.ts)
 *
 * The identity hosts keep in projects is the class ids inside, never the
 * file name: renaming the bundle keeps the plugin, a new plugin.id makes
 * another one.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { writeNotices, type Notice } from '@soundor/runtime-sdk';

import type { describePlugin } from './descriptor';
import type { Vst3Target } from './targets';

type Description = ReturnType<typeof describePlugin>;

/** A file name for the plugin: its name, without path separators. */
export function bundleName(pluginName: string): string {
  return pluginName.replace(/[/\\\0]/g, '_').trim() || 'Plugin';
}

/** The bundle's paths under `dist`. */
export function bundlePaths(
  dist: string,
  pluginName: string,
  target: Vst3Target = 'linux-x64',
) {
  const name = bundleName(pluginName);
  const bundle = join(dist, `${name}.vst3`);
  const contents = join(bundle, 'Contents');
  const [directory, file] =
    target === 'macos-universal'
      ? ['MacOS', name]
      : target === 'windows-x64'
        ? ['x86_64-win', `${name}.vst3`]
        : ['x86_64-linux', `${name}.so`];
  return {
    bundle,
    contents,
    binaryDir: join(contents, directory),
    binary: join(contents, directory, file),
    resources: join(contents, 'Resources'),
  };
}

/** A string as an XML property list holds it. */
function plistString(value: string): string {
  return `<string>${value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')}</string>`;
}

/** A macOS bundle's Info.plist: the bundle's identity, for the system and hosts. */
export function infoPlist(
  description: Description,
  executable: string,
  minimumOs: string,
): string {
  const { plugin } = description;
  const entries: [string, string][] = [
    ['CFBundleDevelopmentRegion', 'English'],
    ['CFBundleExecutable', executable],
    ['CFBundleIdentifier', plugin.id],
    ['CFBundleInfoDictionaryVersion', '6.0'],
    ['CFBundleName', plugin.name],
    ['CFBundlePackageType', 'BNDL'],
    ['CFBundleShortVersionString', plugin.version],
    ['CFBundleSignature', '????'],
    ['CFBundleVersion', plugin.version],
    ['LSMinimumSystemVersion', minimumOs],
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${entries.map(([key, value]) => `\t<key>${key}</key>\n\t${plistString(value)}`).join('\n')}
</dict>
</plist>
`;
}

/** What `moduleinfotool` writes for the module: its factory and classes. */
export function moduleInfo(description: Description, sdkVersion = 'VST 3.8.1') {
  const { plugin } = description;
  const subCategories = plugin.subcategories.split('|');
  const base = {
    Vendor: plugin.vendor,
    Version: plugin.version,
    SDKVersion: sdkVersion,
    Cardinality: 2147483647,
    Snapshots: [],
  };
  return {
    Name: plugin.name,
    Version: plugin.version,
    'Factory Info': {
      Vendor: plugin.vendor,
      URL: plugin.url,
      'E-Mail': plugin.email,
      Flags: {
        Unicode: true,
        'Classes Discardable': false,
        'Component Non Discardable': false,
      },
    },
    Compatibility: [],
    Classes: [
      {
        CID: plugin.processorCid,
        Category: 'Audio Module Class',
        Name: plugin.name,
        ...base,
        'Sub Categories': subCategories,
        // Not kDistributable: the component and its controller share a process.
        'Class Flags': 0,
      },
      {
        CID: plugin.controllerCid,
        Category: 'Component Controller Class',
        Name: `${plugin.name} Controller`,
        ...base,
        'Sub Categories': [],
        'Class Flags': 0,
      },
    ],
  };
}

/** Lays out the bundle around a linked binary's directory: resources and notices. */
export async function writeBundleResources(options: {
  readonly paths: ReturnType<typeof bundlePaths>;
  readonly description: Description;
  /** macOS: the bundle's Info.plist and PkgInfo, for this minimum version. */
  readonly macos?: { readonly minimumOs: string };
  /** The third-party notices of what the binary contains (notices.ts). */
  readonly notices: readonly Notice[];
}): Promise<void> {
  const { paths } = options;
  await rm(paths.resources, { recursive: true, force: true });
  await mkdir(paths.resources, { recursive: true });
  await writeFile(
    join(paths.resources, 'moduleinfo.json'),
    `${JSON.stringify(moduleInfo(options.description), null, 2)}\n`,
  );
  if (options.macos !== undefined) {
    await writeFile(
      join(paths.contents, 'Info.plist'),
      infoPlist(
        options.description,
        bundleName(options.description.plugin.name),
        options.macos.minimumOs,
      ),
    );
    await writeFile(join(paths.contents, 'PkgInfo'), 'BNDL????');
  }
  await writeNotices(join(paths.resources, 'licenses'), options.notices, {
    title: options.description.plugin.name,
  });
}

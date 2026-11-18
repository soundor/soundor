/**
 * The Linux VST3 bundle, as the VST3 specification lays it out:
 *
 *   <Name>.vst3/
 *     Contents/
 *       x86_64-linux/<Name>.so
 *       Resources/
 *         moduleinfo.json      the module's classes, for hosts that scan without loading
 *         licenses/            the notices of what the binary contains
 *
 * The identity hosts keep in projects is the class ids inside, never the
 * file name: renaming the bundle keeps the plugin, a new plugin.id makes
 * another one.
 */

import { existsSync } from 'node:fs';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { describePlugin } from './descriptor';

type Description = ReturnType<typeof describePlugin>;

/** A file name for the plugin: its name, without path separators. */
export function bundleName(pluginName: string): string {
  return pluginName.replace(/[/\\\0]/g, '_').trim() || 'Plugin';
}

/** The bundle's paths under `dist`. */
export function bundlePaths(dist: string, pluginName: string) {
  const name = bundleName(pluginName);
  const bundle = join(dist, `${name}.vst3`);
  return {
    bundle,
    binaryDir: join(bundle, 'Contents', 'x86_64-linux'),
    binary: join(bundle, 'Contents', 'x86_64-linux', `${name}.so`),
    resources: join(bundle, 'Contents', 'Resources'),
  };
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
        // kDistributable: the component and its controller may run apart.
        'Class Flags': 1,
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
  readonly licenses: readonly {
    readonly name: string;
    readonly directory: string;
  }[];
}): Promise<void> {
  const { paths } = options;
  await rm(paths.resources, { recursive: true, force: true });
  await mkdir(paths.resources, { recursive: true });
  await writeFile(
    join(paths.resources, 'moduleinfo.json'),
    `${JSON.stringify(moduleInfo(options.description), null, 2)}\n`,
  );
  for (const license of options.licenses)
    if (existsSync(license.directory))
      await cp(
        license.directory,
        join(paths.resources, 'licenses', license.name),
        { recursive: true },
      );
}

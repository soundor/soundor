// `soundor:fs` in the browser: a private file tree in IndexedDB, confined to
// this plugin's id. The user's own files are never reachable.

import { hostContext } from '../context';
import { createFileSystem } from '../fs';
import { pluginDatabase } from '../persistence';

const { plugin } = hostContext();

export const {
  readBytes,
  readText,
  writeBytes,
  writeText,
  readDir,
  mkdir,
  remove,
  stat,
  exists,
} = createFileSystem(() => pluginDatabase(plugin.id));

export type { DirectoryEntry, FileStat } from '../fs';

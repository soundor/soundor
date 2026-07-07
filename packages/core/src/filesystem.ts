import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, resolve as resolvePath } from 'node:path';

/**
 * Filesystem access scoped to a project root. The interface is the seam a
 * runtime reads/writes through; tests supply an in-memory implementation while
 * {@link createNodeFileSystem} backs it with `node:fs`.
 */
export interface FileSystemHost {
  /** Resolve segments against the root into an absolute path. */
  resolve(...segments: string[]): string;
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, contents: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  rm(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
}

/**
 * A {@link FileSystemHost} backed by `node:fs`. Relative paths are resolved
 * against `root`; absolute paths are used as-is. Writes create parent
 * directories; removals are recursive and ignore missing paths.
 */
export function createNodeFileSystem(root: string): FileSystemHost {
  const abs = (path: string): string =>
    isAbsolute(path) ? path : resolvePath(root, path);

  return {
    resolve(...segments: string[]): string {
      return resolvePath(root, ...segments);
    },
    async exists(path: string): Promise<boolean> {
      try {
        await stat(abs(path));
        return true;
      } catch {
        return false;
      }
    },
    read(path: string): Promise<string> {
      return readFile(abs(path), 'utf8');
    },
    async write(path: string, contents: string): Promise<void> {
      const target = abs(path);
      await mkdir(resolvePath(target, '..'), { recursive: true });
      await writeFile(target, contents, 'utf8');
    },
    async mkdir(path: string): Promise<void> {
      await mkdir(abs(path), { recursive: true });
    },
    async rm(path: string): Promise<void> {
      await rm(abs(path), { recursive: true, force: true });
    },
    readdir(path: string): Promise<string[]> {
      return readdir(abs(path));
    },
  };
}

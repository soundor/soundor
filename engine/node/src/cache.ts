// The Soundor cache (SOUNDOR_CACHE, else the user cache directory: the same
// root as CMake's soundor_cache_root() and the VST3 host's), and the
// primitives that keep it consistent when several processes prepare the
// same artifact: atomic writes and renames, and lock directories.

import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { hostname, homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export function cacheRoot(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (env['SOUNDOR_CACHE']) return env['SOUNDOR_CACHE'];
  if (process.platform === 'win32')
    return join(env['LOCALAPPDATA'] ?? homedir(), 'Soundor', 'cache');
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Caches', 'Soundor');
  return join(env['XDG_CACHE_HOME'] || join(homedir(), '.cache'), 'soundor');
}

/** A file written whole or not at all: readers never see part of it. */
export function writeAtomically(path: string, data: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const partial = `${path}.${randomUUID()}.part`;
  try {
    writeFileSync(partial, data);
    renameSync(partial, path);
  } finally {
    rmSync(partial, { force: true });
  }
}

/** Removes a directory by renaming it aside first, so it disappears at once. */
export function removeDirectory(path: string): void {
  const aside = `${path}.${randomUUID()}.removed`;
  try {
    renameSync(path, aside);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  rmSync(aside, { recursive: true, force: true });
}

interface Owner {
  pid: number;
  host: string;
}

function ownerAlive(owner: Owner): boolean {
  if (owner.host !== hostname()) return true; // Cannot tell: wait for it.
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface LockOptions {
  /** How long to wait for another process. Default: 30 minutes (a build). */
  timeout?: number;
  /** Told once, when another process holds the lock. */
  waiting?: () => void;
}

/**
 * Runs <task> holding the lock <path> (a directory: created atomically on
 * every platform). Another process's lock is waited for; one whose process
 * is gone (on this machine) is taken over.
 */
export async function withLock<T>(
  path: string,
  task: () => Promise<T> | T,
  options: LockOptions = {},
): Promise<T> {
  const deadline = Date.now() + (options.timeout ?? 30 * 60_000);
  const ownerFile = join(path, 'owner.json');
  mkdirSync(dirname(path), { recursive: true });
  let told = false;
  for (;;) {
    try {
      mkdirSync(path);
      writeFileSync(
        ownerFile,
        JSON.stringify({ pid: process.pid, host: hostname() }),
      );
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    let owner: Owner | undefined;
    try {
      owner = JSON.parse(readFileSync(ownerFile, 'utf8')) as Owner;
    } catch {
      // Being created, or its creator died before saying who it is.
    }
    let stale = owner !== undefined && !ownerAlive(owner);
    if (owner === undefined) {
      try {
        stale = Date.now() - statSync(path).mtimeMs > 60_000;
      } catch {
        continue; // Released meanwhile.
      }
    }
    if (stale) {
      removeDirectory(path);
      continue;
    }
    if (Date.now() > deadline)
      throw new Error(
        `Timed out waiting for ${path} (held by process ${owner?.pid ?? 'unknown'}); delete it if no Soundor process is running`,
      );
    if (!told) {
      told = true;
      options.waiting?.();
    }
    await sleep(100 + Math.random() * 150);
  }
  try {
    return await task();
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
}

/**
 * Follows the log a plugin's UI runtime writes in development (one JSON object
 * per line, see the runtime's FileLog), whichever process — a DAW, the
 * Standalone — the plugin runs in.
 */

import { open, stat } from 'node:fs/promises';

export type PluginLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface PluginLogEntry {
  readonly level: PluginLogLevel;
  /** The plugin that wrote it. */
  readonly source: string;
  readonly message: string;
}

const LEVELS = new Set<string>(['debug', 'info', 'warn', 'error']);

/** One log line, or undefined for anything that is not an entry. */
export function parseLogLine(line: string): PluginLogEntry | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const { level, source, message } = value as Record<string, unknown>;
  if (typeof level !== 'string' || !LEVELS.has(level)) return undefined;
  if (typeof source !== 'string' || typeof message !== 'string') {
    return undefined;
  }
  return { level: level as PluginLogLevel, source, message };
}

export interface LogTail {
  /** Reads whatever is new now (also done on every poll). */
  poll(): Promise<void>;
  close(): void;
}

/**
 * Calls `onEntry` for every entry appended to `file` from now on. The file may
 * not exist yet, and may be truncated or replaced; a partial last line waits
 * for its end.
 */
export async function tailLog(
  file: string,
  onEntry: (entry: PluginLogEntry) => void,
  interval = 100,
): Promise<LogTail> {
  let offset = (await stat(file).catch(() => undefined))?.size ?? 0;
  let partial = '';
  const decoder = new TextDecoder();

  const read = async (): Promise<void> => {
    const size = (await stat(file).catch(() => undefined))?.size;
    if (size === undefined) return;
    if (size < offset) {
      offset = 0; // truncated or replaced
      partial = '';
    }
    if (size === offset) return;
    const handle = await open(file, 'r');
    try {
      const buffer = new Uint8Array(size - offset);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      offset += bytesRead;
      partial += decoder.decode(buffer.subarray(0, bytesRead), {
        stream: true,
      });
    } finally {
      await handle.close();
    }
    const lines = partial.split('\n');
    partial = lines.pop()!;
    for (const line of lines) {
      const entry = parseLogLine(line.trimEnd());
      if (entry !== undefined) onEntry(entry);
    }
  };

  // Reads never overlap: a poll waits for the one in flight, then reads.
  let queue = Promise.resolve();
  let pending = 0;
  const poll = (): Promise<void> => {
    pending += 1;
    queue = queue.then(read, read).finally(() => {
      pending -= 1;
    });
    return queue;
  };
  const timer = setInterval(() => {
    if (pending === 0) void poll().catch(() => {});
  }, interval);
  return {
    poll,
    close: () => clearInterval(timer),
  };
}

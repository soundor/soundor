import { createInterface } from 'node:readline';
import { styleText } from 'node:util';

import type { DevShortcut } from '@soundor/config';

export interface BindShortcutsOptions {
  /** The shortcuts at the time a key is typed; `h` is built in. */
  shortcuts: () => readonly DevShortcut[];
  /** Shows help, and errors a shortcut throws. */
  print: (text: string) => void;
  onError: (error: unknown) => void;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WriteStream;
}

/**
 * Runs a shortcut when its key and enter are typed, as Vite does. The input
 * stays in line mode, so Ctrl+C still interrupts the process.
 */
export function bindShortcuts(options: BindShortcutsOptions): () => void {
  const stream = options.output ?? process.stdout;
  const lines = createInterface({ input: options.input ?? process.stdin });
  let running = false;
  lines.on('line', (line) => {
    const key = line.trim();
    if (key === 'h') {
      options.print(formatHelp(options.shortcuts(), stream));
      return;
    }
    const shortcut = options.shortcuts().find((entry) => entry.key === key);
    if (shortcut === undefined || running) return;
    running = true;
    void (async () => {
      try {
        await shortcut.action();
      } catch (error) {
        options.onError(error);
      } finally {
        running = false;
      }
    })();
  });
  return () => lines.close();
}

function formatHelp(
  shortcuts: readonly DevShortcut[],
  stream: NodeJS.WriteStream,
): string {
  const paint = (format: Parameters<typeof styleText>[0], text: string) =>
    styleText(format, text, { stream });
  const rows = [...shortcuts, { key: 'h', description: 'show this help' }].map(
    ({ key, description }) =>
      `  ${paint('dim', 'press')} ${paint('bold', `${key} + enter`)} ${paint('dim', `to ${description}`)}`,
  );
  return `\n  ${paint('bold', 'Shortcuts')}\n${rows.join('\n')}\n`;
}

import { spawn } from 'node:child_process';

/** Where {@link copyToClipboard} put the text. */
export type ClipboardTarget = 'system' | 'terminal';

/**
 * Copies `text` with the platform's clipboard command. Over SSH, or when no
 * command works, asks the terminal to copy it instead (OSC 52), which reaches
 * the clipboard of the machine the terminal runs on in most terminals.
 */
export async function copyToClipboard(
  text: string,
  output: NodeJS.WriteStream = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ClipboardTarget> {
  if (env['SSH_TTY'] === undefined && env['SSH_CONNECTION'] === undefined)
    for (const [cmd, ...args] of clipboardCommands(process.platform, env))
      if (await pipeTo(cmd!, args, text)) return 'system';
  output.write(`\x1b]52;c;${Buffer.from(text).toString('base64')}\x07`);
  return 'terminal';
}

function clipboardCommands(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[][] {
  if (platform === 'darwin') return [['pbcopy']];
  if (platform === 'win32') return [['clip']];
  return [
    ...(env['WAYLAND_DISPLAY'] ? [['wl-copy']] : []),
    ...(env['DISPLAY']
      ? [
          ['xclip', '-selection', 'clipboard'],
          ['xsel', '--clipboard', '--input'],
        ]
      : []),
  ];
}

function pipeTo(cmd: string, args: string[], text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    child.once('error', () => resolve(false));
    child.once('close', (code) => resolve(code === 0));
    child.stdin.on('error', () => {});
    child.stdin.end(text);
  });
}

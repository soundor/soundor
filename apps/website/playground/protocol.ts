/**
 * Messages between a docs page (the editor) and the example host it embeds
 * in playground mode (`?playground=/playground/kit.js`), both on this site's
 * origin.
 */

import type { SourceAssets, SourceFiles } from './modules.ts';

/** Where the playground script is served from (built by build-playground). */
export const PLAYGROUND_SCRIPT = '/playground/kit.js';

/** The host to the page: the playground is ready for code. */
export interface ReadyMessage {
  readonly type: 'soundor:playground:ready';
}

/**
 * The page to the host: say whether you are ready. The host may have said
 * so before the page listened (a page still hydrating); it says it again.
 */
export interface PingMessage {
  readonly type: 'soundor:playground:ping';
}

/** The page to the host: run these files, replacing what ran before. */
export interface RunMessage {
  readonly type: 'soundor:playground:run';
  readonly files: SourceFiles;
  readonly entry: string;
  /** The images the files may import (see `SourceAssets`). */
  readonly assets?: SourceAssets;
}

/** The host to the page: how the last run went, or a later error. */
export interface ResultMessage {
  readonly type: 'soundor:playground:result';
  /** Null when the code runs; else the error, located when possible. */
  readonly error: string | null;
}

export type PlaygroundMessage =
  | ReadyMessage
  | PingMessage
  | RunMessage
  | ResultMessage;

export function isPlaygroundMessage(data: unknown): data is PlaygroundMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { type?: unknown }).type === 'string' &&
    (data as { type: string }).type.startsWith('soundor:playground:')
  );
}

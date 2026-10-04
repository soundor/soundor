/**
 * What the Web host's page and the runtime's Vite plugin agree on. Shared by
 * the browser code and the Node side; nothing here may use either's APIs.
 */

/** Where the page finds the plugin UI's assets, relative to itself. */
export const ASSET_PATH = 'soundor-assets';

/** A UI asset id as the CLI's bundler makes them: content hash + extension. */
export function isAssetId(id: string): boolean {
  return /^[0-9a-f]{16}\.(png|jpe?g|webp)$/.test(id);
}

/** One console entry the page sends to `soundor dev`. */
export interface UiLogEntry {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
}

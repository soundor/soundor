/**
 * `@soundor/web-runtime/vite`: the helper a Web host project's
 * `vite.config.ts` exports its config through.
 *
 *   import { defineWebConfig } from '@soundor/web-runtime/vite';
 *   export default defineWebConfig({ plugins: [myPlugin()] });
 */

import type { Plugin, UserConfig } from 'vite';

import { PLUGIN_NAME } from './plugin';

/**
 * Declares the Web host's own Vite settings. Soundor's lifecycle adds the
 * rest (the plugin UI, the `soundor:*` modules, paths and output) when
 * `soundor dev` or `soundor build` runs Vite, so the config cannot leave
 * them out. Running `vite` directly fails with a pointer to those commands.
 */
export function defineWebConfig(config: UserConfig = {}): UserConfig {
  return {
    ...config,
    plugins: [...(config.plugins ?? []), lifecycleGuard()],
  };
}

function lifecycleGuard(): Plugin {
  return {
    name: 'soundor:web-guard',
    configResolved(resolved) {
      if (!resolved.plugins.some((plugin) => plugin.name === PLUGIN_NAME)) {
        throw new Error(
          'This is a Soundor Web host: run it with `soundor dev web` or `soundor build web`, not with Vite directly.',
        );
      }
    },
  };
}

export type { UserConfig } from 'vite';

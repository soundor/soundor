/**
 * `vst3Runtime({ ... })`'s options, checked at run time (a config is
 * JavaScript, whatever its types say) and resolved with their defaults.
 */

import { RuntimeError } from '@soundor/runtime-sdk';

export interface Vst3Options {
  /**
   * The plugin's VST3 class ids, as 32 hexadecimal digits each. By default
   * they are derived from `plugin.id`, so they never change; set them only to
   * keep the identity of a plugin released with other ids.
   */
  classIds?: { processor: string; controller: string };
  /**
   * How long one call into the UI's JavaScript may run, in milliseconds,
   * before the runtime stops it (`false`: no limit). Default 5000, about when an
   * operating system shows a window as not responding.
   */
  timeLimit?: number | false;
}

export interface ResolvedVst3Options {
  readonly classIds:
    | { readonly processor: string; readonly controller: string }
    | undefined;
  /** Milliseconds; 0 for no limit. */
  readonly timeLimit: number;
}

const HEX = /^[0-9A-Fa-f]{32}$/;

export function resolveVst3Options(
  options: Vst3Options | undefined,
): ResolvedVst3Options {
  const given = (options ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(given))
    if (!['classIds', 'timeLimit'].includes(key))
      throw new RuntimeError(
        `vst3Runtime(): unknown option '${key}' (classIds, timeLimit)`,
      );
  let classIds: ResolvedVst3Options['classIds'];
  if (given['classIds'] !== undefined) {
    const ids = given['classIds'] as Record<string, unknown>;
    if (
      typeof ids !== 'object' ||
      ids === null ||
      typeof ids['processor'] !== 'string' ||
      typeof ids['controller'] !== 'string' ||
      !HEX.test(ids['processor']) ||
      !HEX.test(ids['controller']) ||
      ids['processor'].toUpperCase() === ids['controller'].toUpperCase()
    )
      throw new RuntimeError(
        'vst3Runtime({ classIds }): expected { processor, controller }, two different ids of 32 hexadecimal digits',
      );
    classIds = {
      processor: ids['processor'].toUpperCase(),
      controller: ids['controller'].toUpperCase(),
    };
  }
  const limit = given['timeLimit'];
  if (
    limit !== undefined &&
    limit !== false &&
    (typeof limit !== 'number' || !Number.isInteger(limit) || limit <= 0)
  )
    throw new RuntimeError(
      'vst3Runtime({ timeLimit }): expected a positive whole number of milliseconds, or false',
    );
  return { classIds, timeLimit: limit === false ? 0 : (limit ?? 5000) };
}

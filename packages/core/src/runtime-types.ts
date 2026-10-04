/**
 * The project-independent declarations of Soundor's runtime, committed under
 * runtime/ (see scripts/runtime-types.ts) for packages that build against it.
 */

import { renderGlobalsDts } from './globals-dts';
import { renderUiDts } from './ui-dts';

export function runtimeTypeFiles(): { path: string; contents: string }[] {
  return [
    { path: 'globals.d.ts', contents: renderGlobalsDts() },
    { path: 'ui.d.ts', contents: renderUiDts() },
  ];
}

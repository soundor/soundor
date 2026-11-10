import { version } from '../package.json';

/**
 * This copy's version of `@soundor/core`, inlined when it is built. A host
 * (the CLI) checks a runtime's declared `core` range against it.
 */
export const CORE_VERSION: string = version;

/** Copies the examples' web builds into the site (see `examples.ts`). */

import { syncExamples } from './examples.ts';

const synced = syncExamples(new URL('..', import.meta.url).pathname);
console.log(`Examples: ${synced.join(', ')}`);

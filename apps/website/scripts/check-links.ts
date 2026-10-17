/** Fails the build when the built site has a problem (see `links.ts`). */

import { checkSite } from './links.ts';

const problems = await checkSite(
  new URL('../dist/client/', import.meta.url).pathname,
);
if (problems.length > 0) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} problem(s) in the built site`);
  process.exit(1);
}
console.log('All pages are complete; internal links and anchors resolve.');

import { relative, resolve } from 'node:path';

function safe(name: string): string {
  return name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Where a test leaves what a person needs to see why it failed. */
export function resultsDir(
  root: string,
  testFile: string,
  testName: string,
): string {
  return resolve(
    root,
    '.soundor',
    'test-results',
    safe(relative(root, testFile)),
    safe(testName),
  );
}

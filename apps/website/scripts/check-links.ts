/**
 * Fails when a page of the built site is incomplete, or links to a page or an
 * anchor that does not exist. Prerendering already fails on a missing page it
 * crawls; this also checks `#anchors`, which the docs use a lot and nothing
 * else verifies, and that every page was written whole (Nitro's preview
 * server once cut long pages short, silently).
 *
 * Run after `vite build`, on `dist/client`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('../dist/client/', import.meta.url).pathname;

/** The HTML file a site path is served from, if any. */
function fileFor(path: string): string | undefined {
  const clean = decodeURIComponent(path).replace(/\/$/, '');
  for (const candidate of [
    join(ROOT, clean, 'index.html'),
    join(ROOT, `${clean}.html`),
    join(ROOT, clean),
  ]) {
    if (existsSync(candidate) && !candidate.endsWith('/')) return candidate;
  }
  return undefined;
}

const ids = new Map<string, Set<string>>();
function idsOf(file: string): Set<string> {
  let found = ids.get(file);
  if (found === undefined) {
    const html = readFileSync(file, 'utf-8');
    found = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
    ids.set(file, found);
  }
  return found;
}

const problems: string[] = [];
for await (const page of glob('**/*.html', { cwd: ROOT })) {
  const html = readFileSync(join(ROOT, page), 'utf-8');
  if (page.startsWith('examples/')) continue; // copied example builds
  if (!html.trimEnd().endsWith('</html>')) {
    problems.push(`${page}: incomplete (${html.length} bytes, no </html>)`);
  }
  for (const [, href] of html.matchAll(/\shref="([^"]+)"/g)) {
    if (href === undefined || !href.startsWith('/')) continue;
    if (href.startsWith('/assets/') || href.startsWith('//')) continue;
    const [path = '', anchor] = href.split('#');
    const target = path === '' ? join(ROOT, page) : fileFor(path);
    if (target === undefined) {
      problems.push(`${page}: ${href}: no such page`);
    } else if (
      anchor !== undefined &&
      anchor !== '' &&
      target.endsWith('.html') &&
      !idsOf(target).has(decodeURIComponent(anchor))
    ) {
      problems.push(`${page}: ${href}: no such anchor`);
    }
  }
}

if (problems.length > 0) {
  console.error([...new Set(problems)].sort().join('\n'));
  console.error(`\n${problems.length} broken link(s)`);
  process.exit(1);
}
console.log('All internal links and anchors resolve.');

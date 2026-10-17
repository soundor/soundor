/**
 * Checks a built site: every page complete, and every internal link and
 * `#anchor` resolving, same-page anchors included. Prerendering already fails on a missing page it
 * crawls; this also checks anchors, which the docs use a lot and nothing else
 * verifies, and that every page was written whole (Nitro's preview server once
 * cut long pages short, silently).
 */

import { existsSync, readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { join } from 'node:path';

/** The problems in the site under `root` (`dist/client`), sorted; none is []. */
export async function checkSite(root: string): Promise<string[]> {
  /** The file a site path is served from, if any. */
  const fileFor = (path: string): string | undefined => {
    const clean = decodeURIComponent(path).replace(/\/$/, '');
    return [
      join(root, clean, 'index.html'),
      join(root, `${clean}.html`),
      join(root, clean),
    ].find((candidate) => existsSync(candidate) && candidate !== root);
  };

  const ids = new Map<string, Set<string>>();
  const idsOf = (file: string): Set<string> => {
    let found = ids.get(file);
    if (found === undefined) {
      const html = readFileSync(file, 'utf-8');
      found = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
      ids.set(file, found);
    }
    return found;
  };

  const problems = new Set<string>();
  for await (const page of glob('**/*.html', { cwd: root })) {
    if (page.startsWith('examples/')) continue; // copied example builds
    const html = readFileSync(join(root, page), 'utf-8');
    if (!html.trimEnd().endsWith('</html>')) {
      problems.add(`${page}: incomplete (no </html>)`);
    }
    for (const [, href] of html.matchAll(/\shref="([^"]+)"/g)) {
      // Site paths and same-page anchors; other sites are not checked.
      if (href === undefined || !/^[/#]/.test(href)) continue;
      if (href.startsWith('/assets/') || href.startsWith('//')) continue;
      const [path = '', anchor] = href.split('#');
      const target = path === '' ? join(root, page) : fileFor(path);
      if (target === undefined) {
        problems.add(`${page}: ${href}: no such page`);
      } else if (
        anchor !== undefined &&
        anchor !== '' &&
        target.endsWith('.html') &&
        !idsOf(target).has(decodeURIComponent(anchor))
      ) {
        problems.add(`${page}: ${href}: no such anchor`);
      }
    }
  }
  return [...problems].sort();
}

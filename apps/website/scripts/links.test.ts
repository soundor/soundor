import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkSite } from './links.ts';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A built site of `files` (path → HTML body; a page gets `</html>`). */
function site(files: Record<string, string>): string {
  root = mkdtempSync(join(tmpdir(), 'site-'));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(
      join(root, path),
      path.endsWith('.html') ? `<html><body>${body}</body></html>` : body,
    );
  }
  return root;
}

describe('checkSite', () => {
  it('accepts pages, folders, files and anchors that exist', async () => {
    const problems = await checkSite(
      site({
        'index.html': [
          '<a href="/docs/react#hooks">hooks</a>',
          '<a href="/docs">docs</a>',
          '<a href="/docs/react.md">markdown</a>',
          '<a href="#top">top</a><h1 id="top">Home</h1>',
          '<a href="/assets/app.css">css</a>',
          '<a href="https://example.com/missing">external</a>',
        ].join(''),
        'docs/index.html': '',
        'docs/react/index.html': '<h2 id="hooks">Hooks</h2>',
        'docs/react.md': '# React',
      }),
    );
    expect(problems).toEqual([]);
  });

  it('reports a missing page and a missing anchor', async () => {
    const problems = await checkSite(
      site({
        'index.html':
          '<a href="/docs/nope">a</a><a href="/docs#gone">b</a><a href="#here">c</a>',
        'docs/index.html': '<h2 id="there">There</h2>',
      }),
    );
    expect(problems).toEqual([
      'index.html: #here: no such anchor',
      'index.html: /docs#gone: no such anchor',
      'index.html: /docs/nope: no such page',
    ]);
  });

  it('reports a page cut short', async () => {
    root = mkdtempSync(join(tmpdir(), 'site-'));
    writeFileSync(join(root, 'index.html'), '<html><body><p>Part of a pa');
    expect(await checkSite(root)).toEqual([
      'index.html: incomplete (no </html>)',
    ]);
  });

  it('leaves the copied example builds alone', async () => {
    const problems = await checkSite(
      site({ 'examples/basic/index.html': '<a href="/nowhere">x</a>' }),
    );
    expect(problems).toEqual([]);
  });
});

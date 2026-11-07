import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { generateChangelog, parseChangelog } from './changelog.ts';

describe('parseChangelog', () => {
  it('keeps multiline notes and omits dependency-only updates', () => {
    const releases = parseChangelog(`# soundor

## 1.2.0

### Minor Changes

- [#42](https://example.com/42) Add a feature.

  Migration instructions with \`code\`.

### Patch Changes

- Updated dependencies [commit]:
  - @soundor/core@1.2.0

- Fix a bug.

## 1.1.0

### Patch Changes

- An older fix.
`);
    expect([...releases.keys()]).toEqual(['1.2.0', '1.1.0']);
    expect(releases.get('1.2.0')).toEqual([
      {
        kind: 'Minor Changes',
        markdown:
          '- [#42](https://example.com/42) Add a feature.\n\n  Migration instructions with `code`.',
      },
      { kind: 'Patch Changes', markdown: '- Fix a bug.' },
    ]);
    expect(releases.get('1.1.0')).toEqual([
      { kind: 'Patch Changes', markdown: '- An older fix.' },
    ]);
  });
});

describe('generateChangelog', () => {
  it('keeps independently versioned runtimes out of shared Soundor releases', () => {
    const root = mkdtempSync(join(tmpdir(), 'soundor-changelog-'));
    const out = join(root, 'generated');
    try {
      for (const [path, name, note] of [
        ['packages/cli', 'soundor', 'CLI change'],
        ['runtimes/web-runtime', '@soundor/web-runtime', 'Web runtime change'],
        [
          'runtimes/juce-runtime',
          '@soundor/juce-runtime',
          'JUCE runtime change',
        ],
        ['runtimes/engine', '@soundor/engine', 'Engine change'],
      ]) {
        const dir = join(root, path!);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ name }));
        writeFileSync(
          join(dir, 'CHANGELOG.md'),
          `# ${name}\n\n## 1.0.0\n\n### Minor Changes\n\n- ${note}\n`,
        );
      }
      mkdirSync(out);
      writeFileSync(join(out, '0.9.0.md'), 'Obsolete generated page');
      generateChangelog(pathToFileURL(root + '/'), pathToFileURL(out + '/'));
      const shared = readFileSync(join(out, '1.0.0.md'), 'utf8');
      expect(shared).toContain('CLI change');
      expect(shared).not.toContain('runtime change');
      expect(shared).not.toContain('Engine change');
      expect(readFileSync(join(out, 'web-runtime.md'), 'utf8')).toContain(
        'Web Runtime 1.0.0',
      );
      expect(readFileSync(join(out, 'juce-runtime.md'), 'utf8')).toContain(
        'JUCE Runtime 1.0.0',
      );
      const index = readFileSync(join(out, 'index.md'), 'utf8');
      expect(index).toContain('/docs/changelog/web-runtime');
      expect(index).toContain('/docs/changelog/juce-runtime');
      expect(readdirSync(out)).not.toContain('0.9.0.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

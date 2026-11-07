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

import {
  generateChangelog,
  parseChangelog,
  summarizeChanges,
} from './changelog.ts';

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

describe('summarizeChanges', () => {
  it('counts categories without double-counting pre-1.0 breaking features', () => {
    expect(
      summarizeChanges([
        { kind: 'Minor Changes', markdown: '- Add a feature.' },
        { kind: 'Patch Changes', markdown: '- Fix a bug.' },
        { kind: 'Major Changes', markdown: '- Remove an API.' },
        { kind: 'Minor Changes', markdown: '- **Breaking:** Replace an API.' },
        {
          kind: 'Minor Changes',
          markdown: '- New protocol.\n\n  Breaking: old clients must update.',
        },
        { kind: '', markdown: '- Another change.' },
        {
          kind: 'Patch Changes',
          markdown: '- A non-breaking fix with `Breaking: code`.',
        },
      ]),
    ).toEqual({ total: 7, features: 1, fixes: 2, breaking: 3, other: 1 });
    expect(summarizeChanges([])).toEqual({
      total: 0,
      features: 0,
      fixes: 0,
      breaking: 0,
      other: 0,
    });
  });
});

describe('generateChangelog', () => {
  it('keeps independently versioned runtimes out of shared Soundor releases', () => {
    const root = mkdtempSync(join(tmpdir(), 'soundor-changelog-'));
    const out = join(root, 'generated');
    try {
      for (const [path, name, note] of [
        ['packages/cli', 'soundor', 'CLI change'],
        ['packages/core', '@soundor/core', 'CLI change'],
        ['runtimes/web-runtime', '@soundor/web-runtime', 'Web runtime change'],
        [
          'runtimes/juce-runtime',
          '@soundor/juce-runtime',
          'JUCE runtime change',
        ],
        ['engines/engine', '@soundor/engine', 'Engine change'],
        ['engines/yoga-wasm', '@soundor/yoga-wasm', 'Yoga WASM change'],
        ['hosts/vst3-host', '@soundor/vst3-host', 'VST3 Host change'],
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
      const shared = readFileSync(join(out, 'soundor/1.0.0.md'), 'utf8');
      expect(shared).toContain('CLI change');
      expect(shared).toContain('**1 change** — 1 feature');
      expect(shared).toContain('`@soundor/core`, `soundor`');
      expect(shared).not.toContain('runtime change');
      expect(shared).not.toContain('Engine change');
      expect(shared).not.toContain('Yoga WASM change');
      expect(shared).not.toContain('VST3 Host change');
      expect(readFileSync(join(out, 'vst3-host/1.0.0.md'), 'utf8')).toContain(
        'VST3 Host 1.0.0',
      );
      expect(readFileSync(join(out, 'yoga-wasm/1.0.0.md'), 'utf8')).toContain(
        'Yoga WASM 1.0.0',
      );
      expect(readFileSync(join(out, 'web-runtime/1.0.0.md'), 'utf8')).toContain(
        'Web Runtime 1.0.0',
      );
      expect(
        readFileSync(join(out, 'juce-runtime/1.0.0.md'), 'utf8'),
      ).toContain('JUCE Runtime 1.0.0');
      const sidebar = JSON.parse(
        readFileSync(join(out, 'web-runtime/meta.json'), 'utf8'),
      );
      expect(sidebar).toMatchObject({
        title: 'Web Runtime',
        collapsible: true,
        defaultOpen: false,
        pages: ['index', '1.0.0'],
      });
      expect(readFileSync(join(out, 'web-runtime/index.md'), 'utf8')).toContain(
        '/docs/changelog/web-runtime/1.0.0',
      );
      expect(
        JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8')).pages,
      ).toEqual([
        'index',
        '---Packages---',
        'soundor',
        '---Runtimes---',
        'juce-runtime',
        'web-runtime',
        '---Engines---',
        'engine',
        'yoga-wasm',
        '---Hosts---',
        'vst3-host',
      ]);
      const index = readFileSync(join(out, 'index.md'), 'utf8');
      expect(index).toContain('/docs/changelog/web-runtime');
      expect(index).toContain(
        '[1.0.0](/docs/changelog/soundor/1.0.0): **1 change** — 1 feature',
      );
      expect(readFileSync(join(out, 'soundor/index.md'), 'utf8')).toContain(
        '| [1.0.0](/docs/changelog/soundor/1.0.0) | 1 | 1 | 0 | 0 | 0 |',
      );
      expect(index).toContain('/docs/changelog/juce-runtime');
      expect(index).toContain('/docs/changelog/yoga-wasm');
      expect(index).toContain('/docs/changelog/vst3-host');
      rmSync(join(root, 'engines/yoga-wasm/CHANGELOG.md'));
      rmSync(join(root, 'hosts/vst3-host/CHANGELOG.md'));
      generateChangelog(pathToFileURL(root + '/'), pathToFileURL(out + '/'));
      expect(readFileSync(join(out, 'yoga-wasm/index.md'), 'utf8')).toContain(
        'No published release notes yet.',
      );
      expect(readFileSync(join(out, 'vst3-host/index.md'), 'utf8')).toContain(
        'No published release notes yet.',
      );
      expect(readdirSync(out)).not.toContain('0.9.0.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

import { describe, expect, it } from 'vitest';

import { fillPlaceholders, type SiteValues } from './placeholders';

const values: SiteValues = {
  versions: { soundor: '0.10.1', '@soundor/react': '0.10.2' },
  node: '^22.18.0 || >=24.11.0',
};

describe('fillPlaceholders', () => {
  it('fills package versions and the Node versions', () => {
    expect(
      fillPlaceholders(
        'npx soundor@%version:soundor% (React %version:@soundor/react%) on Node %node%',
        values,
        'page.md',
      ),
    ).toBe('npx soundor@0.10.1 (React 0.10.2) on Node ^22.18.0 || >=24.11.0');
  });

  it('fails on a package the workspace does not have, naming where', () => {
    expect(() =>
      fillPlaceholders('%version:soundr%', values, 'guides/start.md'),
    ).toThrow('guides/start.md: %version:soundr% names no workspace package');
  });

  it('leaves text that is not a placeholder alone', () => {
    for (const text of [
      '50% of 100%',
      '`%version:<package>%`, in prose about placeholders',
      '%Node% %VERSION:soundor%',
    ]) {
      expect(fillPlaceholders(text, values, 'page.md')).toBe(text);
    }
  });
});

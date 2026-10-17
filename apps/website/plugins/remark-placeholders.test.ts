import { remarkNpm } from 'fumadocs-core/mdx-plugins/remark-npm';
import type { Code, Root } from 'mdast';
import { VFile } from 'vfile';
import { describe, expect, it } from 'vitest';

import { packageManagers } from './package-managers.ts';
import { remarkPlaceholders } from './remark-placeholders.ts';

const values = { versions: { 'create-soundor-app': '0.10.1' }, node: '>=24' };
const run = (tree: Root) =>
  remarkPlaceholders(values)()(tree, new VFile({ path: 'page.md' }));

describe('remarkPlaceholders', () => {
  it('fills text, inline code and code blocks, however deep', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'list',
          children: [
            {
              type: 'listItem',
              children: [
                {
                  type: 'paragraph',
                  children: [
                    { type: 'text', value: 'Node %node%, with ' },
                    {
                      type: 'inlineCode',
                      value: 'create-soundor-app@%version:create-soundor-app%',
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'code',
          lang: 'sh',
          value:
            'npm create soundor-app@%version:create-soundor-app% my-plugin',
        },
      ],
    };
    run(tree);
    expect(JSON.stringify(tree)).not.toContain('%');
    expect(JSON.stringify(tree)).toContain('Node >=24, with ');
    expect((tree.children[1] as Code).value).toBe(
      'npm create soundor-app@0.10.1 my-plugin',
    );
  });

  it('fails the page on an unknown placeholder', () => {
    const tree: Root = {
      type: 'root',
      children: [{ type: 'code', value: '%version:nope%' }],
    };
    expect(() => run(tree)).toThrow('page.md: %version:nope%');
  });

  it('runs before the install tabs, so every tab has the version', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'code',
          lang: 'package-install',
          value: 'npm i create-soundor-app@%version:create-soundor-app%',
        },
      ],
    };
    run(tree);
    remarkNpm({ packageManagers })(tree, new VFile(), () => {});
    const tabs = JSON.stringify(tree);
    expect(tabs).toContain('pnpm add create-soundor-app@0.10.1');
    expect(tabs).toContain('npm i create-soundor-app@0.10.1');
    expect(tabs).not.toMatch(/yarn|bun/);
  });
});

import type { Root } from 'mdast';
import { VFile } from 'vfile';
import { describe, expect, it } from 'vitest';

import { remarkSnippets } from './remark-snippets.ts';

const snippets: Record<string, string> = {
  gain: 'export default function Gain() {}\n',
};

/** A page with one `<Snippet>`, as MDX parses it: `attributes` its props. */
function page(attributes: { name: string; value: unknown }[]): Root {
  return {
    type: 'root',
    children: [
      {
        type: 'mdxJsxFlowElement',
        name: 'Snippet',
        attributes: attributes.map((attribute) => ({
          type: 'mdxJsxAttribute',
          ...attribute,
        })),
        children: [],
      } as unknown as Root['children'][number],
    ],
  };
}

const run = (tree: Root) =>
  remarkSnippets((name) => snippets[name])()(
    tree,
    new VFile({ path: 'content/docs/react.mdx' }),
  );

describe('remarkSnippets', () => {
  it('gives a snippet its code, as a tsx block', () => {
    const tree = page([
      { name: 'name', value: 'gain' },
      { name: 'height', value: { type: 'mdxJsxAttributeValueExpression' } },
    ]);
    run(tree);
    expect(tree.children[0]).toMatchObject({
      children: [
        {
          type: 'code',
          lang: 'tsx',
          value: 'export default function Gain() {}',
        },
      ],
    });
  });

  it('fails on a snippet that does not exist, saying where', () => {
    expect(() => run(page([{ name: 'name', value: 'nope' }]))).toThrow(
      'content/docs/react.mdx: there is no snippet "nope"',
    );
  });

  it('fails on a snippet without a name', () => {
    expect(() => run(page([]))).toThrow('<Snippet> needs name="<snippet>"');
  });
});

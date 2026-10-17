import { describe, expect, it } from 'vitest';

import { inlineSnippets } from './snippet-markdown.ts';

const read = (name: string) =>
  name === 'gain' ? 'export default function Gain() {}\n' : undefined;

describe('inlineSnippets', () => {
  it("puts the snippet's code where the component was", () => {
    expect(
      inlineSnippets('Try it:\n\n<Snippet name="gain" height={200} />\n', read),
    ).toBe('Try it:\n\n```tsx\nexport default function Gain() {}\n```\n');
  });

  it('leaves what it does not know alone', () => {
    const markdown = '<Snippet name="nope" />';
    expect(inlineSnippets(markdown, read)).toBe(markdown);
  });
});

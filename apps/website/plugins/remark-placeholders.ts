import type { Root } from 'mdast';
import type { VFile } from 'vfile';

import { fillPlaceholders, type SiteValues } from '../src/lib/placeholders.ts';

/**
 * Replaces `%version:<package>%` and `%node%` in text, inline code and code
 * blocks (see `src/lib/placeholders.ts`). Runs before Fumadocs' own plugins, so the
 * package-manager tabs `remarkNpm` makes from a code block get the values
 * too.
 */
export function remarkPlaceholders(values: SiteValues) {
  return () => (tree: Root, file: VFile) => {
    const where = file.path ?? 'content';
    const visit = (node: Root | Root['children'][number]): void => {
      if (
        node.type === 'text' ||
        node.type === 'inlineCode' ||
        node.type === 'code'
      ) {
        node.value = fillPlaceholders(node.value, values, where);
      }
      if ('children' in node) {
        for (const child of node.children) visit(child);
      }
    };
    visit(tree);
  };
}

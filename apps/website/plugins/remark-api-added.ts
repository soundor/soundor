import { resolve } from 'node:path';

import { replaceSource } from 'fumadocs-core/mdx-plugins/stringifier';
import type { Paragraph, Root } from 'mdast';
import type { VFile } from 'vfile';

import { addedIn, apiVersion } from './api-added.ts';
import { REPOSITORY } from './type-tables.ts';

/** `<ApiAdded>` resolves from source at build time, including Markdown exports. */
export function remarkApiAdded() {
  return (tree: Root, file: VFile) => {
    const visit = (parent: { children: unknown[] }): void => {
      parent.children = parent.children.map((child) => {
        const node = child as {
          type: string;
          name?: string;
          attributes?: { type: string; name?: string; value?: unknown }[];
          children?: unknown[];
        };
        if (node.type === 'mdxJsxFlowElement' && node.name === 'ApiAdded') {
          const attribute = (name: string) =>
            node.attributes?.find(
              (attribute) =>
                attribute.type === 'mdxJsxAttribute' && attribute.name === name,
            )?.value;
          const path = attribute('path');
          const name = attribute('name');
          if (typeof path !== 'string' || typeof name !== 'string')
            throw new Error(
              `${file.path}: <ApiAdded> needs path and name strings`,
            );
          const label = addedIn(apiVersion(resolve(REPOSITORY, path), name));
          replaceSource(file, child as Root['children'][number], label);
          return {
            type: 'paragraph',
            data: { hProperties: { className: ['api-added'] } },
            children: [
              {
                type: 'text',
                value: label,
              },
            ],
          } satisfies Paragraph;
        }
        if (node.children) visit(node as { children: unknown[] });
        return child;
      });
    };
    visit(tree);
  };
}

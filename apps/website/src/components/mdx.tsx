import { TypeTable } from 'fumadocs-ui/components/type-table';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';

import { Example } from './example';
import { Mermaid } from './mermaid';
import { Snippet } from './snippet';

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Example,
    Mermaid,
    Snippet,
    TypeTable,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}

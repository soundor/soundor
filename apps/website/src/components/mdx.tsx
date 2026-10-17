import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';

import { Example } from './example';
import { Snippet } from './snippet';

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Example,
    Snippet,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}

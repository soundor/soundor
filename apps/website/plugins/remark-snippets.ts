import type { Code, Root } from 'mdast';
import type { VFile } from 'vfile';

/** `<Snippet name="…" />` in MDX, as the parser gives it. */
interface SnippetElement {
  readonly type: 'mdxJsxFlowElement';
  readonly name: string | null;
  readonly attributes: readonly {
    readonly type: string;
    readonly name?: string;
    readonly value?: unknown;
  }[];
  children: Code[];
}

function isSnippet(node: unknown): node is SnippetElement {
  const element = node as Partial<SnippetElement>;
  return element.type === 'mdxJsxFlowElement' && element.name === 'Snippet';
}

/**
 * Gives every `<Snippet name>` its code, as a `tsx` code block child: the
 * page then has it highlighted, and readable without JavaScript, from the
 * file the preview runs. An unknown snippet fails the build.
 */
export function remarkSnippets(read: (name: string) => string | undefined) {
  return () => (tree: Root, file: VFile) => {
    const where = file.path ?? 'content';
    const visit = (node: unknown): void => {
      if (isSnippet(node)) {
        const name = node.attributes.find(
          (attribute) =>
            attribute.type === 'mdxJsxAttribute' && attribute.name === 'name',
        )?.value;
        if (typeof name !== 'string') {
          throw new Error(`${where}: <Snippet> needs name="<snippet>"`);
        }
        const code = read(name);
        if (code === undefined) {
          throw new Error(`${where}: there is no snippet "${name}"`);
        }
        node.children = [{ type: 'code', lang: 'tsx', value: code.trimEnd() }];
        return;
      }
      const children = (node as { children?: unknown[] }).children;
      if (Array.isArray(children)) for (const child of children) visit(child);
    };
    visit(tree);
  };
}

/**
 * `<Snippet name>` in a page's Markdown (`/docs/….md`, `llms-full.txt`),
 * replaced with the snippet's code: agents read code, not components.
 */
export function inlineSnippets(
  markdown: string,
  read: (name: string) => string | undefined,
): string {
  return markdown.replace(
    /<Snippet\b[^>]*?\bname="([^"]+)"[^>]*?\/>/g,
    (element, name: string) => {
      const code = read(name);
      return code === undefined
        ? element
        : `\`\`\`tsx\n${code.trimEnd()}\n\`\`\``;
    },
  );
}

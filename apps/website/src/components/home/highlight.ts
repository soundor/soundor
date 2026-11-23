import { createServerFn } from '@tanstack/react-start';
import { staticFunctionMiddleware } from '@tanstack/start-static-server-functions';
import { getHighlighter } from 'fumadocs-core/highlight';

import { type FileId, files } from './flow';

/** A file's code, highlighted: the `<pre>`'s class and each line's HTML. */
export interface Highlighted {
  readonly className: string;
  readonly lines: readonly {
    readonly className: string;
    readonly html: string;
  }[];
}

/**
 * The home page's code, highlighted when the site is built, in the docs'
 * themes, line by line so that the page can write it out. Marked lines get
 * the docs' `highlighted` class.
 */
export const highlightFlow = createServerFn({ method: 'GET' })
  .middleware([staticFunctionMiddleware])
  .handler(async () => {
    const highlighter = await getHighlighter('js', {
      langs: ['ts', 'tsx', 'rust', 'sh'],
      themes: ['github-light', 'github-dark'],
    });
    const entries = Object.entries(files).map(([id, file]) => {
      const html = highlighter.codeToHtml(file.code, {
        lang: file.lang,
        themes: { light: 'github-light', dark: 'github-dark' },
        defaultColor: false,
        transformers: [
          {
            line(node, line) {
              if (file.marks.includes(line))
                this.addClassToHast(node, 'highlighted');
            },
          },
        ],
      });
      const fail = () => new Error(`unexpected highlighter output for ${id}`);
      const parts =
        /^<pre class="([^"]*)"[^>]*><code>([\s\S]*)<\/code><\/pre>$/.exec(html);
      if (!parts) throw fail();
      // Shiki puts one `<span class="line">` per line, with newlines between.
      const lines = parts[2]!.split('\n').map((line) => {
        const span = /^<span class="([^"]*)">([\s\S]*)<\/span>$/.exec(line);
        if (!span) throw fail();
        return { className: span[1]!, html: span[2]! };
      });
      const highlighted: Highlighted = { className: parts[1]!, lines };
      return [id, highlighted] as const;
    });
    return Object.fromEntries(entries) as Record<FileId, Highlighted>;
  });

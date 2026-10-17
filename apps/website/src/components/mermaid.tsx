import { useEffect, useId, useState } from 'react';

import { useDarkMode } from '@/lib/use-dark-mode';

export interface MermaidProps {
  /** The diagram's Mermaid source: a ```mermaid block's code. */
  readonly chart: string;
}

type Rendered =
  | { readonly kind: 'source' }
  | { readonly kind: 'svg'; readonly svg: string }
  | { readonly kind: 'error'; readonly message: string };

/**
 * A ```mermaid code block, drawn: `remarkMdxMermaid` turns the block into
 * this component, which draws it in the browser in the site's theme.
 * Mermaid is large, so it loads only on a page with a diagram. Until then,
 * and without JavaScript, the page shows the diagram's source.
 */
export function Mermaid({ chart }: MermaidProps) {
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  const dark = useDarkMode();
  const [rendered, setRendered] = useState<Rendered>({ kind: 'source' });

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: dark ? 'dark' : 'default',
          fontFamily: 'inherit',
        });
        const { svg } = await mermaid.render(id, chart);
        if (current) setRendered({ kind: 'svg', svg });
      } catch (error) {
        if (current) {
          setRendered({
            kind: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => {
      current = false;
    };
  }, [chart, dark, id]);

  if (rendered.kind === 'svg') {
    return (
      <figure
        className="not-prose my-6 flex justify-center overflow-x-auto [&_svg]:h-auto [&_svg]:max-w-full"
        // Mermaid's own output, from the page's own source, in strict mode.
        dangerouslySetInnerHTML={{ __html: rendered.svg }}
      />
    );
  }
  return (
    <figure className="not-prose my-6 rounded-xl border bg-fd-card text-sm">
      {rendered.kind === 'error' ? (
        <figcaption className="border-b px-4 py-2 text-fd-error">
          The diagram did not render: {rendered.message}
        </figcaption>
      ) : null}
      <pre className="overflow-x-auto p-4">
        <code>{chart}</code>
      </pre>
    </figure>
  );
}

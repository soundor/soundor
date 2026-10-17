import { RotateCcw } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { repository } from '@/lib/shared';

import { PLAYGROUND_SCRIPT } from '../../playground/protocol.ts';
import {
  ActionButton,
  FullscreenButton,
  LiveFigure,
  useEditor,
  useHydrated,
} from './live/figure';
import { loadJson, type Sources } from './live/sources';
import { useFullscreen } from './live/use-fullscreen';
import { usePlayground } from './live/use-playground';

/** The example the snippets live in (`examples/snippets`). */
const PROJECT = 'snippets';

export interface SnippetProps {
  /** The snippet: a file of `examples/snippets/src/snippets/`, without `.tsx`. */
  readonly name: string;
  /** The preview's height in pixels; the snippet's view is this size. */
  readonly height?: number;
  /** Its code, highlighted: added at build time (`remark-snippets.ts`). */
  readonly children?: ReactNode;
}

/**
 * A snippet from `examples/snippets` running live: the plugin view alone
 * (the web host's `embed` presentation, as big as the preview), always in
 * playground mode, its code under it. "Edit code" turns the code into an
 * editor; "Replay" runs it again from the start.
 */
export function Snippet({ name, height = 240, children }: SnippetProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const hydrated = useHydrated();
  const figure = useRef<HTMLElement>(null);
  const fullscreen = useFullscreen(figure);
  const { Editor, opening, open } = useEditor();
  const [sources, setSources] = useState<Sources | null>(null);
  const playground = usePlayground(frame, sources);

  useEffect(() => {
    loadJson<Sources>(`/examples/${PROJECT}/snippets/${name}.json`)
      .then(setSources)
      .catch((error: unknown) =>
        console.error(`The snippet ${name} did not load:`, error),
      );
  }, [name]);

  const file = `src/snippets/${name}.tsx`;
  return (
    <LiveFigure
      figure={figure}
      fullscreen={fullscreen}
      frame={frame}
      src={`/examples/${PROJECT}/index.html?embed&playground=${encodeURIComponent(PLAYGROUND_SCRIPT)}`}
      title={`The ${name} snippet, running in the browser`}
      height={height}
      editor={
        opening && Editor !== null && sources !== null ? (
          <Editor
            sources={sources}
            typesUrl={`/examples/${PROJECT}/types.json`}
            playground={playground}
            expanded={fullscreen.expanded}
          />
        ) : null
      }
      code={
        // One scrollbar: the code block's own, made shorter.
        <div className="border-t [&_.fd-scroll-container]:max-h-[360px] [&_figure]:my-0 [&_figure]:rounded-none [&_figure]:border-0">
          {children}
        </div>
      }
      caption={<code>{name}.tsx</code>}
      actions={
        <>
          <ActionButton
            onClick={() => playground.replay()}
            disabled={!hydrated || playground.status.kind === 'loading'}
          >
            <RotateCcw className="size-3.5" aria-hidden />
            Replay
          </ActionButton>
          {opening ? null : (
            <ActionButton strong onClick={open} disabled={!hydrated}>
              Edit code
            </ActionButton>
          )}
          <FullscreenButton
            fullscreen={fullscreen}
            onExpand={open}
            disabled={!hydrated}
          />
          <a
            href={`${repository.url}/blob/${repository.branch}/examples/${PROJECT}/${file}`}
            className="hover:text-fd-foreground"
          >
            Source
          </a>
        </>
      }
    />
  );
}

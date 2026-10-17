import { useEffect, useRef, useState } from 'react';

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

export interface ExampleProps {
  /** The example's package name: a directory of `examples/`. */
  readonly name: string;
  /** The embed's height in pixels; the plugin scales down to fit. */
  readonly height?: number;
}

/**
 * An example from `examples/`, running in the web runtime: its static web
 * build, copied to `/examples/<name>/` by `scripts/sync-examples.ts`. "Edit
 * code" opens its UI files in an editor and runs them when applied; "Full
 * screen" puts the editor and the plugin side by side, filling the screen.
 */
export function Example({ name, height = 560 }: ExampleProps) {
  // index.html by name: Vite's dev server does not serve a folder's index
  // (TanStack's router would redirect it and 404); every server serves this.
  const page = `/examples/${name}/index.html`;
  const frame = useRef<HTMLIFrameElement>(null);
  const hydrated = useHydrated();
  const figure = useRef<HTMLElement>(null);
  const fullscreen = useFullscreen(figure);
  const { Editor, opening, open } = useEditor();
  const [sources, setSources] = useState<Sources | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const playground = usePlayground(frame, sources);

  // The code loads with the editor, and the host switches to running it.
  useEffect(() => {
    if (!opening) return;
    loadJson<Sources>(`/examples/${name}/playground.json`)
      .then(setSources)
      .catch((error: unknown) =>
        setFailure(`The example's code did not load (${String(error)}).`),
      );
  }, [opening, name]);

  return (
    <LiveFigure
      figure={figure}
      fullscreen={fullscreen}
      frame={frame}
      // In playground mode the host runs the editor's code, not its build.
      src={
        opening
          ? `${page}?playground=${encodeURIComponent(PLAYGROUND_SCRIPT)}`
          : page
      }
      title={`The ${name} example, running in the browser`}
      height={height}
      editor={
        failure !== null ? (
          <p className="border-t px-4 py-3 text-sm text-fd-error">{failure}</p>
        ) : opening ? (
          Editor === null || sources === null ? (
            <p className="border-t px-4 py-3 text-sm">Loading the code…</p>
          ) : (
            <Editor
              sources={sources}
              typesUrl={`/examples/${name}/types.json`}
              playground={playground}
              expanded={fullscreen.expanded}
            />
          )
        ) : null
      }
      caption={
        <>
          <code>examples/{name}</code> in the web runtime. Press ▶ in the bar
          under the plugin to hear it.
        </>
      }
      actions={
        <>
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
            href={page}
            target="_blank"
            rel="noreferrer"
            className="hover:text-fd-foreground"
          >
            Open full page
          </a>
          <a
            href={`${repository.url}/tree/${repository.branch}/examples/${name}`}
            className="hover:text-fd-foreground"
          >
            Source
          </a>
        </>
      }
    />
  );
}

import { Maximize2, Minimize2 } from 'lucide-react';
import {
  type ComponentType,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { repository } from '@/lib/shared';

import { PLAYGROUND_SCRIPT } from '../../playground/protocol.ts';
import type { ExampleEditorProps } from './example-editor';

const noChanges = () => () => {};

export interface ExampleProps {
  /** The example's package name: a directory of `examples/`. */
  readonly name: string;
  /** The embed's height in pixels; the plugin scales down to fit. */
  readonly height?: number;
}

/**
 * An example from `examples/`, running in the web runtime: its static web
 * build, copied to `/examples/<name>/` by `scripts/sync-examples.ts`. "Edit
 * code" opens its UI files in an editor and runs them as they change; "Full
 * screen" puts the editor and the plugin side by side, filling the screen.
 */
export function Example({ name, height = 560 }: ExampleProps) {
  // index.html by name: Vite's dev server does not serve a folder's index
  // (TanStack's router would redirect it and 404); every server serves this.
  const page = `/examples/${name}/index.html`;
  const frame = useRef<HTMLIFrameElement>(null);
  const [Editor, setEditor] =
    useState<ComponentType<ExampleEditorProps> | null>(null);
  const [opening, setOpening] = useState(false);
  const figure = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  // The buttons work once the page has hydrated; until then, they say so.
  const hydrated = useSyncExternalStore(
    noChanges,
    () => true,
    () => false,
  );

  const edit = () => {
    if (opening) return;
    setOpening(true);
    // The editor (CodeMirror) loads only for readers who edit.
    void import('./example-editor').then((module) =>
      setEditor(() => module.ExampleEditor),
    );
  };

  const expand = () => {
    edit();
    setExpanded(true);
    // Where the page may not take the screen (iOS), the figure covers the
    // window instead.
    figure.current?.requestFullscreen?.().catch(() => {});
  };
  const collapse = () => {
    setExpanded(false);
    if (document.fullscreenElement !== null) void document.exitFullscreen();
  };

  useEffect(() => {
    if (!expanded) return;
    // The browser leaves full screen on Escape itself.
    const left = () => {
      if (document.fullscreenElement === null) setExpanded(false);
    };
    const escape = (event: KeyboardEvent) => {
      // Not when the editor used it, to close its completions, say.
      if (event.key === 'Escape' && !event.defaultPrevented) collapse();
    };
    // The page under it stays put, and gives up its scrollbar's room.
    const { body, documentElement: root } = document;
    const saved = [body.style.overflow, root.style.scrollbarGutter] as const;
    body.style.overflow = 'hidden';
    root.style.scrollbarGutter = 'auto';
    document.addEventListener('fullscreenchange', left);
    document.addEventListener('keydown', escape);
    return () => {
      [body.style.overflow, root.style.scrollbarGutter] = saved;
      document.removeEventListener('fullscreenchange', left);
      document.removeEventListener('keydown', escape);
    };
  }, [expanded]);

  return (
    <figure
      ref={figure}
      className={`not-prose flex flex-col overflow-hidden ${expanded ? 'fixed inset-0 z-[100] bg-fd-background' : 'my-6 rounded-xl border bg-fd-card'}`}
    >
      <div
        className={
          expanded
            ? 'grid min-h-0 flex-1 grid-rows-2 lg:grid-cols-2 lg:grid-rows-1'
            : undefined
        }
      >
        <iframe
          ref={frame}
          // In playground mode the host runs the editor's code, not its build.
          src={
            Editor === null
              ? page
              : `${page}?playground=${encodeURIComponent(PLAYGROUND_SCRIPT)}`
          }
          title={`The ${name} example, running in the browser`}
          loading="lazy"
          allow="autoplay"
          className={`block w-full border-0 ${expanded ? 'h-full lg:order-2 lg:border-l' : ''}`}
          style={expanded ? undefined : { height }}
        />
        {Editor === null ? null : (
          <div className={expanded ? 'min-h-0 lg:order-1' : undefined}>
            <Editor name={name} frame={frame} expanded={expanded} />
          </div>
        )}
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-sm text-fd-muted-foreground">
        <span>
          <code>examples/{name}</code> in the web runtime. Start audio in the
          bar under the plugin.
        </span>
        <span className="flex gap-4">
          {Editor === null ? (
            <button
              type="button"
              onClick={edit}
              disabled={!hydrated || opening}
              className="font-medium text-fd-foreground hover:underline disabled:opacity-60"
            >
              {opening ? 'Opening…' : 'Edit code'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={expanded ? collapse : expand}
            disabled={!hydrated}
            className="inline-flex items-center gap-1 hover:text-fd-foreground disabled:opacity-60"
          >
            {expanded ? (
              <Minimize2 className="size-3.5" aria-hidden />
            ) : (
              <Maximize2 className="size-3.5" aria-hidden />
            )}
            {expanded ? 'Exit full screen' : 'Full screen'}
          </button>
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
        </span>
      </figcaption>
    </figure>
  );
}

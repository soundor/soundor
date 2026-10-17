import { type ComponentType, useRef, useState } from 'react';

import { repository } from '@/lib/shared';

import { PLAYGROUND_SCRIPT } from '../../playground/protocol.ts';
import type { ExampleEditorProps } from './example-editor';

export interface ExampleProps {
  /** The example's package name: a directory of `examples/`. */
  readonly name: string;
  /** The embed's height in pixels; the plugin scales down to fit. */
  readonly height?: number;
}

/**
 * An example from `examples/`, running in the web runtime: its static web
 * build, copied to `/examples/<name>/` by `scripts/sync-examples.ts`. "Edit
 * code" opens its UI files in an editor and runs them as they change.
 */
export function Example({ name, height = 560 }: ExampleProps) {
  // index.html by name: Vite's dev server does not serve a folder's index
  // (TanStack's router would redirect it and 404); every server serves this.
  const page = `/examples/${name}/index.html`;
  const frame = useRef<HTMLIFrameElement>(null);
  const [Editor, setEditor] =
    useState<ComponentType<ExampleEditorProps> | null>(null);
  const [opening, setOpening] = useState(false);

  const edit = () => {
    setOpening(true);
    // The editor (CodeMirror) loads only for readers who edit.
    void import('./example-editor').then((module) =>
      setEditor(() => module.ExampleEditor),
    );
  };

  return (
    <figure className="not-prose my-6 overflow-hidden rounded-xl border bg-fd-card">
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
        className="block w-full border-0"
        style={{ height }}
      />
      {Editor === null ? null : <Editor name={name} frame={frame} />}
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
              disabled={opening}
              className="font-medium text-fd-foreground hover:underline disabled:opacity-60"
            >
              {opening ? 'Opening…' : 'Edit code'}
            </button>
          ) : null}
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

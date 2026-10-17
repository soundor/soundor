import { repository } from '@/lib/shared';

export interface ExampleProps {
  /** The example's package name: a directory of `examples/`. */
  readonly name: string;
  /** The embed's height in pixels; the plugin scales down to fit. */
  readonly height?: number;
}

/**
 * An example from `examples/`, running in the web runtime: its static web
 * build, copied to `/examples/<name>/` by `scripts/sync-examples.ts`.
 */
export function Example({ name, height = 560 }: ExampleProps) {
  const src = `/examples/${name}/`;
  return (
    <figure className="not-prose my-6 overflow-hidden rounded-xl border bg-fd-card">
      <iframe
        src={src}
        title={`The ${name} example, running in the browser`}
        loading="lazy"
        allow="autoplay"
        className="block w-full border-0"
        style={{ height }}
      />
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-sm text-fd-muted-foreground">
        <span>
          <code>examples/{name}</code> in the web runtime. Start audio in the
          bar under the plugin.
        </span>
        <span className="flex gap-4">
          <a
            href={src}
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

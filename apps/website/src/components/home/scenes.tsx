import { CodeBlock, Pre } from 'fumadocs-ui/components/codeblock';
import { buttonVariants } from 'fumadocs-ui/components/ui/button';
import { Check, LoaderCircle } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import type { Highlighted } from './highlight';

/**
 * The pieces of the workflow's scenes. Each takes how far its part of the
 * step has got, from 0 to 1, as the reader scrolls: code is written, a
 * command runs, a result appears.
 */

/** How far `p` is between `from` and `to`, from 0 to 1. */
export const phase = (p: number, from: number, to: number) =>
  Math.min(1, Math.max(0, (p - from) / (to - from)));

/** A file's code, written line by line as `shown` goes from 0 to 1. */
export function CodeReveal({
  file,
  code,
  shown,
}: {
  readonly file: string;
  readonly code: Highlighted;
  readonly shown: number;
}) {
  const visible = Math.ceil(shown * code.lines.length);
  return (
    <CodeBlock title={file} className="my-0">
      <Pre className={code.className}>
        <code>
          {code.lines.map((line, index) => (
            <span
              // The lines of one file never move.
              // oxlint-disable-next-line react/no-array-index-key
              key={index}
              className={`${line.className} transition-[opacity,translate] duration-300 ${index < visible ? 'opacity-100' : 'translate-y-1 opacity-0'}`}
              // Shiki's output for the site's own code, made at build time.
              // oxlint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: line.html }}
            />
          ))}
        </code>
      </Pre>
    </CodeBlock>
  );
}

/** A command, typed out as `shown` goes from 0 to 1. */
export function CommandType({
  command,
  shown,
}: {
  readonly command: string;
  readonly shown: number;
}) {
  const typed = command.slice(0, Math.round(shown * command.length));
  return (
    <CodeBlock title="Terminal" className="my-0" allowCopy={shown >= 1}>
      <Pre>
        <code>
          <span className="line">
            <span className="text-fd-muted-foreground select-none">$ </span>
            {typed}
            {shown < 1 && (
              <span
                aria-hidden
                className="ml-px inline-block h-4 w-2 translate-y-0.5 animate-pulse bg-fd-primary"
              />
            )}
          </span>
        </code>
      </Pre>
    </CodeBlock>
  );
}

/**
 * A task running: hidden before it starts, then a spinner and a bar while
 * `progress` fills, then done.
 */
export function Run({
  label,
  done,
  progress,
  started,
}: {
  readonly label: string;
  readonly done: string;
  readonly progress: number;
  readonly started: boolean;
}) {
  const finished = progress >= 1;
  return (
    <div
      className={`rounded-xl border bg-fd-card px-3 py-2.5 text-sm transition-[opacity,translate] duration-300 ${started ? 'opacity-100' : 'translate-y-2 opacity-0'}`}
    >
      <div className="flex items-center gap-2">
        {finished ? (
          <Check
            aria-hidden
            className="size-4 text-green-600 dark:text-green-400"
          />
        ) : (
          <LoaderCircle
            aria-hidden
            className="size-4 animate-spin text-fd-muted-foreground motion-reduce:animate-none"
          />
        )}
        <span className={finished ? '' : 'text-fd-muted-foreground'}>
          {finished ? done : label}
        </span>
        <span className="ml-auto text-xs text-fd-muted-foreground tabular-nums">
          {Math.round(progress * 100)}%
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-fd-muted">
        <div
          className={`h-full rounded-full ${finished ? 'bg-green-600 dark:bg-green-400' : 'bg-fd-primary'}`}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}

/** A result, rising into place as `shown` reaches 1. */
export function Reveal({
  shown,
  children,
}: {
  readonly shown: number;
  readonly children: ReactNode;
}) {
  return (
    <div
      className="transition-[opacity,translate,scale] duration-500"
      style={{
        opacity: shown,
        translate: `0 ${(1 - shown) * 16}px`,
        scale: `${0.97 + shown * 0.03}`,
      }}
    >
      {children}
    </div>
  );
}

/** A test that passed, as Vitest reports it. */
export function Passed({
  file,
  name,
}: {
  readonly file: string;
  readonly name: string;
}) {
  return (
    <div className="rounded-xl border border-green-600/30 bg-green-600/5 p-3 text-sm dark:border-green-400/30 dark:bg-green-400/5">
      <p className="flex items-center gap-2 font-medium text-green-700 dark:text-green-400">
        <Check aria-hidden className="size-4" /> 1 test passed
      </p>
      <p className="mt-1 font-mono text-xs text-fd-muted-foreground">
        {file} › {name}
      </p>
    </div>
  );
}

/** The processor's work: the input, and the output at half its level. */
export function GainWave() {
  const wave = (amplitude: number) =>
    Array.from({ length: 121 }, (_, i) => {
      const x = (i / 120) * 400;
      const y = 50 - Math.sin((i / 120) * Math.PI * 6) * 40 * amplitude;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  return (
    <figure className="m-0 rounded-xl border bg-fd-card p-3">
      <svg
        viewBox="0 0 400 100"
        className="h-24 w-full"
        role="img"
        aria-label="A sine wave in, and the same wave out at half the level"
      >
        <line
          x1="0"
          x2="400"
          y1="50"
          y2="50"
          className="stroke-fd-border"
          strokeWidth="1"
        />
        <path
          d={wave(1)}
          fill="none"
          className="stroke-fd-muted-foreground/40"
          strokeWidth="2"
        />
        <path
          d={wave(0.5)}
          fill="none"
          className="stroke-fd-primary"
          strokeWidth="2.5"
        />
      </svg>
      <figcaption className="mt-2 flex gap-4 text-xs text-fd-muted-foreground">
        <span>Input</span>
        <span className="text-fd-foreground">Output, gain 0.5</span>
      </figcaption>
    </figure>
  );
}

/** What App.tsx draws: the gain and a button that resets it, which works. */
export function GainPreview() {
  const [gain, setGain] = useState(0.75);
  return (
    <div className="overflow-hidden rounded-xl border bg-fd-card text-sm">
      <div className="border-b px-3 py-2 text-xs text-fd-muted-foreground">
        My Plugin
      </div>
      <div className="space-y-3 p-4">
        <p>
          Gain <output className="tabular-nums">{gain.toFixed(2)}</output>
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-fd-muted">
          <div
            className="h-full rounded-full bg-fd-primary transition-[width] duration-300"
            style={{ width: `${gain * 100}%` }}
          />
        </div>
        <button
          type="button"
          onClick={() => setGain(0.5)}
          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
        >
          Reset gain
        </button>
      </div>
    </div>
  );
}

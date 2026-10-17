/**
 * The editor `<Example>` opens: the example's UI files in CodeMirror, run in
 * the embedded host (in playground mode) as they are edited, and checked by
 * TypeScript against the example's own types (completions, errors, types on
 * hover). Loaded only when a reader asks to edit.
 */

import { javascript } from '@codemirror/lang-javascript';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { type RefObject, useEffect, useRef, useState } from 'react';

import {
  isPlaygroundMessage,
  type RunMessage,
} from '../../playground/protocol.ts';
import type { ExampleTypes } from '../editor/language-service.ts';
import { TypeScriptClient, typescript } from '../editor/typescript.ts';

/** How long typing pauses before the code runs. */
const RUN_DELAY_MS = 400;

interface Sources {
  readonly entry: string;
  readonly files: Readonly<Record<string, string>>;
}

export interface ExampleEditorProps {
  readonly name: string;
  /** The host the code runs in, already in playground mode. */
  readonly frame: RefObject<HTMLIFrameElement | null>;
  /** Full screen: the editor fills the height it is given. */
  readonly expanded: boolean;
}

type Status =
  | { readonly kind: 'loading' }
  | { readonly kind: 'running' }
  | { readonly kind: 'ok' }
  | { readonly kind: 'error'; readonly message: string };

function useDarkMode(): boolean {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains('dark'),
  );
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains('dark')),
    );
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);
  return dark;
}

async function load<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status}`);
  return (await response.json()) as T;
}

export function ExampleEditor({ name, frame, expanded }: ExampleEditorProps) {
  const [original, setOriginal] = useState<Sources | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const files = useRef<Record<string, string>>({});
  const [active, setActive] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [ready, setReady] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [resets, setResets] = useState(0);
  const [client, setClient] = useState<TypeScriptClient | null>(null);
  const dark = useDarkMode();

  useEffect(() => {
    let started: TypeScriptClient | undefined;
    load<Sources>(`/examples/${name}/playground.json`)
      .then((sources) => {
        started = new TypeScriptClient(
          load<ExampleTypes>(`/examples/${name}/types.json`),
          sources.files,
        );
        setClient(started);
        setOriginal(sources);
        files.current = { ...sources.files };
        // The entry usually only renders the app: open the app itself.
        setActive(
          Object.keys(sources.files).find((file) => file !== sources.entry) ??
            sources.entry,
        );
      })
      .catch((error: unknown) =>
        setFailure(`The example's code did not load (${String(error)}).`),
      );
    return () => started?.dispose();
  }, [name]);

  const run = (): void => {
    const target = frame.current?.contentWindow;
    if (target == null || original === null) return;
    setStatus({ kind: 'running' });
    const message: RunMessage = {
      type: 'soundor:playground:run',
      files: { ...files.current },
      entry: original.entry,
    };
    target.postMessage(message, window.location.origin);
  };

  // The host's messages: ready for code, and how each run went.
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== window.location.origin ||
        !isPlaygroundMessage(event.data)
      ) {
        return;
      }
      if (event.data.type === 'soundor:playground:ready') setReady(true);
      if (event.data.type === 'soundor:playground:result') {
        setStatus(
          event.data.error === null
            ? { kind: 'ok' }
            : { kind: 'error', message: event.data.error },
        );
      }
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, [frame]);

  // Run once the host is ready and the code has loaded.
  useEffect(() => {
    if (ready && original !== null) run();
    // `run` reads refs; it changes with nothing else.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, original, resets]);

  // The editor for the active file, recreated when it or the theme changes.
  useEffect(() => {
    if (host.current === null || active === null || client === null) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: files.current[active] ?? '',
        extensions: [
          basicSetup,
          javascript({ jsx: true, typescript: true }),
          typescript(client, active),
          ...(dark ? [oneDark] : []),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            files.current[active] = update.state.doc.toString();
            clearTimeout(timer.current);
            timer.current = setTimeout(run, RUN_DELAY_MS);
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [active, dark, resets, client]);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (failure !== null) {
    return <p className="px-4 py-3 text-sm text-fd-error">{failure}</p>;
  }
  if (original === null || active === null) {
    return <p className="px-4 py-3 text-sm">Loading the code…</p>;
  }

  return (
    <div
      className={`flex min-h-0 flex-col border-t ${expanded ? 'h-full' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1">
        {Object.keys(original.files).map((file) => (
          <button
            key={file}
            type="button"
            onClick={() => setActive(file)}
            aria-pressed={file === active}
            className="rounded px-2 py-1 font-mono text-xs text-fd-muted-foreground aria-pressed:bg-fd-accent aria-pressed:text-fd-foreground"
          >
            {file}
          </button>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            files.current = { ...original.files };
            for (const [file, text] of Object.entries(original.files)) {
              void client?.call('update', file, text);
            }
            setResets((count) => count + 1);
          }}
          className="rounded px-2 py-1 text-xs text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground"
        >
          Reset
        </button>
      </div>
      <div
        ref={host}
        className={`overflow-auto text-sm [&_.cm-editor.cm-focused]:outline-none ${expanded ? 'min-h-0 flex-1 [&_.cm-editor]:h-full' : 'max-h-[420px] [&_.cm-editor]:min-h-[240px]'}`}
      />
      <p
        role="status"
        className={`border-t px-4 py-2 font-mono text-xs ${status.kind === 'error' ? 'text-fd-error' : 'text-fd-muted-foreground'}`}
      >
        {status.kind === 'loading'
          ? 'Starting the playground…'
          : status.kind === 'running'
            ? 'Running…'
            : status.kind === 'ok'
              ? 'Running your code. Edit it to see the change.'
              : status.message}
      </p>
    </div>
  );
}

/**
 * The editor a live preview opens: its code in CodeMirror, run in the
 * preview's host (in playground mode) when applied, and checked by
 * TypeScript against the example's own types (completions, errors, types on
 * hover). Loaded only when a reader asks to edit.
 */

import { javascript } from '@codemirror/lang-javascript';
import { EditorState, Prec } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { useEffect, useRef, useState } from 'react';

import type { ExampleTypes } from '../../editor/language-service.ts';
import { TypeScriptClient, typescript } from '../../editor/typescript.ts';
import { loadJson, type Sources } from './sources';
import type { Playground } from './use-playground';

/** The shortcut that applies the changes, as the Apply button shows it. */
const APPLY_KEY = 'Mod-Enter';

function applyShortcut(): string {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘↵' : 'Ctrl+Enter';
}

export interface CodeEditorProps {
  readonly sources: Sources;
  /** The types the code is checked against (`types.json`). */
  readonly typesUrl: string;
  /** The preview the code runs in. */
  readonly playground: Playground;
  /** Full screen: the editor fills the height it is given. */
  readonly expanded: boolean;
}

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

export function CodeEditor({
  sources,
  typesUrl,
  playground,
  expanded,
}: CodeEditorProps) {
  const tabs = sources.editable ?? Object.keys(sources.files);
  const files = useRef<Record<string, string>>({ ...sources.files });
  // The entry usually only renders the app: open the app itself.
  const [active, setActive] = useState(
    () => tabs.find((file) => file !== sources.entry) ?? sources.entry,
  );
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [resets, setResets] = useState(0);
  // Edits wait to be applied: running on every change would take the
  // reader's focus and the plugin's state with it while they type.
  const [changed, setChanged] = useState(false);
  const [client, setClient] = useState<TypeScriptClient | null>(null);
  const dark = useDarkMode();
  const { status } = playground;

  useEffect(() => {
    const started = new TypeScriptClient(
      loadJson<ExampleTypes>(typesUrl),
      sources.files,
    );
    setClient(started);
    return () => started.dispose();
  }, [sources, typesUrl]);

  const apply = (): void => {
    setChanged(false);
    playground.run(files.current);
  };

  // The editor for the active file, recreated when it or the theme changes.
  useEffect(() => {
    if (host.current === null || client === null) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: files.current[active] ?? '',
        extensions: [
          basicSetup,
          javascript({ jsx: true, typescript: true }),
          typescript(client, active),
          ...(dark ? [oneDark] : []),
          // Before the default keymap's Mod-Enter (a new line below).
          Prec.highest(
            keymap.of([
              {
                key: APPLY_KEY,
                run: () => {
                  apply();
                  return true;
                },
              },
            ]),
          ),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            files.current[active] = update.state.doc.toString();
            setChanged(true);
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // `apply` reads refs and props that stay for the editor's life.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [active, dark, resets, client]);

  return (
    <div
      className={`flex min-h-0 flex-col border-t ${expanded ? 'h-full' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1">
        {tabs.map((file) => (
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
            files.current = { ...sources.files };
            for (const [file, text] of Object.entries(sources.files)) {
              void client?.call('update', file, text);
            }
            setChanged(false);
            setResets((count) => count + 1);
            playground.run(sources.files);
          }}
          className="rounded px-2 py-1 text-xs text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => {
            apply();
            view.current?.focus();
          }}
          disabled={!changed}
          title={`Run your changes (${applyShortcut()})`}
          className="rounded bg-fd-primary px-2 py-1 text-xs font-medium text-fd-primary-foreground disabled:opacity-50"
        >
          Apply <span className="opacity-70">{applyShortcut()}</span>
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
            : status.kind === 'error'
              ? status.message
              : changed
                ? `Edited: apply (${applyShortcut()}) to run your changes.`
                : 'Running your code. Edit it, then apply.'}
      </p>
    </div>
  );
}

/**
 * TypeScript in the editor: completions, errors and types on hover, from the
 * language service in `typescript.worker.ts`, which knows the example's real
 * types (`types.json`: the `soundor:*` modules, `@soundor/react`, React).
 */

import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { type Diagnostic, linter } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import { EditorView, hoverTooltip } from '@codemirror/view';

import type {
  Documented,
  ExampleLanguageService,
  ExampleTypes,
} from './language-service.ts';

type Service = ExampleLanguageService;
type Method = keyof Service;

/** A call of the worker's language service, or its start. */
export type WorkerRequest =
  | {
      readonly id: number;
      readonly method: 'init';
      readonly args: [ExampleTypes, Readonly<Record<string, string>>];
    }
  | {
      [M in Method]: {
        readonly id: number;
        readonly method: M;
        readonly args: Parameters<Service[M]>;
      };
    }[Method];

export type WorkerResponse =
  | { readonly id: number; readonly result: unknown }
  | { readonly id: number; readonly error: string };

/** The page's side of the worker: the language service, asynchronously. */
export class TypeScriptClient {
  readonly #worker: Worker;
  readonly #pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  #next = 0;
  readonly #ready: Promise<unknown>;

  /** Starts the language service once `types` load. */
  constructor(
    types: Promise<ExampleTypes>,
    code: Readonly<Record<string, string>>,
  ) {
    this.#worker = new Worker(
      new URL('./typescript.worker.ts', import.meta.url),
      { type: 'module', name: 'typescript' },
    );
    this.#worker.addEventListener(
      'message',
      (event: MessageEvent<WorkerResponse>) => {
        const call = this.#pending.get(event.data.id);
        this.#pending.delete(event.data.id);
        if ('error' in event.data) call?.reject(new Error(event.data.error));
        else call?.resolve(event.data.result);
      },
    );
    this.#ready = types.then((loaded) =>
      this.#send({ id: this.#next++, method: 'init', args: [loaded, code] }),
    );
    // Without types the editor still edits: it only knows less.
    this.#ready.catch((error: unknown) =>
      console.error('The editor has no TypeScript:', error),
    );
  }

  #send(request: WorkerRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.#pending.set(request.id, { resolve, reject });
      this.#worker.postMessage(request);
    });
  }

  /** Calls the language service, once it has started. */
  async call<M extends Method>(
    method: M,
    ...args: Parameters<Service[M]>
  ): Promise<ReturnType<Service[M]>> {
    await this.#ready;
    const request = { id: this.#next++, method, args } as WorkerRequest;
    return (await this.#send(request)) as ReturnType<Service[M]>;
  }

  dispose(): void {
    this.#worker.terminate();
    for (const call of this.#pending.values()) {
      call.reject(new Error('The editor closed'));
    }
    this.#pending.clear();
  }
}

/** A declaration and its documentation, as the tooltips show them. */
function documentation({ signature, documentation }: Documented): HTMLElement {
  const element = document.createElement('div');
  element.className = 'cm-ts-info';
  const code = element.appendChild(document.createElement('pre'));
  code.textContent = signature;
  if (documentation !== '') {
    element.appendChild(document.createElement('p')).textContent =
      documentation;
  }
  return element;
}

const theme = EditorView.baseTheme({
  '.cm-ts-info': {
    maxWidth: '36rem',
    padding: '4px 8px',
    fontSize: '12px',
  },
  '.cm-ts-info pre': {
    margin: '0',
    whiteSpace: 'pre-wrap',
    fontFamily: 'var(--default-mono-font-family, monospace)',
  },
  '.cm-ts-info p': { margin: '6px 0 0', whiteSpace: 'pre-wrap' },
});

/**
 * TypeScript for the editor of `file` (`src/App.tsx`): completions, errors
 * and hover types, and the worker kept up to date with what is typed.
 */
export function typescript(client: TypeScriptClient, file: string): Extension {
  const complete = async (
    context: CompletionContext,
  ): Promise<CompletionResult | null> => {
    const list = await client
      .call('complete', file, context.pos, context.explicit)
      .catch(() => null);
    if (list === null || context.aborted) return null;
    return {
      from: list.from,
      options: list.options.map((option): Completion => ({
        ...option,
        info: async () => {
          const details = await client
            .call('describe', file, context.pos, option.label)
            .catch(() => null);
          return details === null ? null : documentation(details);
        },
      })),
      validFor: /^[\w$]*$/,
    };
  };

  return [
    theme,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        void client.call('update', file, update.state.doc.toString());
      }
    }),
    autocompletion({ override: [complete] }),
    linter(
      async (view) => {
        const problems = await client.call('problems', file).catch(() => []);
        const length = view.state.doc.length;
        return problems.map((problem): Diagnostic => ({
          ...problem,
          from: Math.min(problem.from, length),
          to: Math.min(problem.to, length),
        }));
      },
      { delay: 300 },
    ),
    hoverTooltip(async (_view, pos) => {
      const info = await client.call('quickInfo', file, pos).catch(() => null);
      if (info === null) return null;
      return {
        pos: info.from,
        end: info.to,
        create: () => ({ dom: documentation(info) }),
      };
    }),
  ];
}

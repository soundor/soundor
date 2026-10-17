/**
 * TypeScript's language service over an example's code: completions, the
 * errors `tsc` would report and the types under the pointer, for the
 * editor. The example's types (`types.json`, from `scripts/types.ts`) and its
 * files, as they are edited, are all it reads: there is no file system.
 *
 * It takes TypeScript as an argument so that it runs in the editor's worker
 * and in Node's tests alike.
 */

import type ts from 'typescript-6';

/** What `types.json` holds: the example's options and declaration files. */
export interface ExampleTypes {
  /** The example's compiler options, as `tsconfig.app.json` sets them. */
  readonly options: Readonly<Record<string, unknown>>;
  /** The declaration files the program includes besides the code. */
  readonly roots: readonly string[];
  /** Every declaration file and `package.json` the check reads, by path. */
  readonly files: Readonly<Record<string, string>>;
}

export interface CompletionOption {
  readonly label: string;
  /** CodeMirror's kind of completion, for its icon. */
  readonly type: string | undefined;
  readonly boost: number;
}

export interface CompletionList {
  /** Where the completed word starts. */
  readonly from: number;
  readonly options: readonly CompletionOption[];
}

export interface Problem {
  readonly from: number;
  readonly to: number;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
}

/** A declaration, as TypeScript prints it, and its documentation. */
export interface Documented {
  /** `const gain: number`, `function View(props: ViewProps): …`. */
  readonly signature: string;
  readonly documentation: string;
}

/** What is under the pointer: where it is, and its declaration. */
export interface QuickInfo extends Documented {
  readonly from: number;
  readonly to: number;
}

/** TypeScript's kinds of completion, as CodeMirror's icons name them. */
const COMPLETION_TYPES: Readonly<Record<string, string>> = {
  class: 'class',
  const: 'constant',
  enum: 'enum',
  function: 'function',
  interface: 'interface',
  keyword: 'keyword',
  let: 'variable',
  local: 'variable',
  'local function': 'function',
  method: 'method',
  module: 'namespace',
  property: 'property',
  getter: 'property',
  setter: 'property',
  type: 'type',
  'type parameter': 'type',
  var: 'variable',
  'JSX attribute': 'property',
  string: 'text',
};

/** What, typed just before a word, asks for completions. */
const TRIGGERS = new Set(['.', '<', '"', "'", '`']);

/** The identifier, or the start of one, that ends at `pos`. */
function wordStart(text: string, pos: number): number {
  let start = pos;
  while (start > 0 && /[\w$]/.test(text[start - 1] ?? '')) start--;
  return start;
}

export type ExampleLanguageService = ReturnType<typeof createLanguageService>;

/**
 * A language service over the example's `types` and `code` (its editable
 * files, by path from its root: `src/App.tsx`).
 */
export function createLanguageService(
  typescript: typeof ts,
  types: ExampleTypes,
  code: Readonly<Record<string, string>>,
) {
  const sources = new Map<string, { text: string; version: number }>();
  for (const [file, text] of Object.entries(code)) {
    sources.set(`/${file}`, { text, version: 0 });
  }
  const read = (path: string): string | undefined =>
    sources.get(path)?.text ?? types.files[path];

  const directories = new Set<string>(['/']);
  for (const path of [...Object.keys(types.files), ...sources.keys()]) {
    for (
      let at = path.lastIndexOf('/');
      at > 0;
      at = path.lastIndexOf('/', at - 1)
    ) {
      directories.add(path.slice(0, at));
    }
  }

  const options = typescript.convertCompilerOptionsFromJson({}, '/').options;
  Object.assign(options, types.options);
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => [...types.roots, ...sources.keys()],
    getScriptVersion: (path) => String(sources.get(path)?.version ?? 0),
    getScriptSnapshot: (path) => {
      const text = read(path);
      return text === undefined
        ? undefined
        : typescript.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => '/',
    getDefaultLibFileName: (settings) =>
      `/node_modules/typescript/lib/${typescript.getDefaultLibFileName(settings)}`,
    fileExists: (path) => read(path) !== undefined,
    readFile: read,
    directoryExists: (path) => directories.has(path.replace(/\/$/, '')),
    getDirectories: (path) => {
      const prefix = path.endsWith('/') ? path : `${path}/`;
      return [...directories]
        .filter(
          (dir) =>
            dir.startsWith(prefix) && !dir.slice(prefix.length).includes('/'),
        )
        .map((dir) => dir.slice(prefix.length));
    },
    useCaseSensitiveFileNames: () => true,
  };
  const service = typescript.createLanguageService(
    host,
    typescript.createDocumentRegistry(true, '/'),
  );
  const message = (text: string | ts.DiagnosticMessageChain): string =>
    typescript.flattenDiagnosticMessageText(text, '\n');

  return {
    /** The file at `file` (`src/App.tsx`) now reads `text`. */
    update(file: string, text: string): void {
      const source = sources.get(`/${file}`);
      if (source === undefined) {
        sources.set(`/${file}`, { text, version: 0 });
      } else if (source.text !== text) {
        source.text = text;
        source.version++;
      }
    },

    /**
     * What may be typed at `pos`: nothing after whitespace, unless asked
     * for (`explicit`, Ctrl+Space) or just after a trigger: `.` (members),
     * `<` (JSX) or a quote (a string's values: an enum's, say).
     */
    complete(
      file: string,
      pos: number,
      explicit: boolean,
    ): CompletionList | null {
      const path = `/${file}`;
      const text = read(path) ?? '';
      const from = wordStart(text, pos);
      const before = text[from - 1] ?? '';
      const trigger = TRIGGERS.has(before)
        ? (before as ts.CompletionsTriggerCharacter)
        : undefined;
      if (!explicit && from === pos && trigger === undefined) return null;
      const info = service.getCompletionsAtPosition(path, pos, {
        includeCompletionsWithInsertText: true,
        triggerCharacter: from === pos ? trigger : undefined,
      });
      if (info === undefined) return null;
      return {
        from,
        options: info.entries
          .filter(
            (entry) => entry.kind !== typescript.ScriptElementKind.warning,
          )
          .map((entry) => ({
            label: entry.name,
            type: COMPLETION_TYPES[entry.kind],
            // TypeScript sorts by text ("11" before "15"); CodeMirror by boost.
            boost: Math.max(-99, 11 - Number.parseInt(entry.sortText, 10) || 0),
          })),
      };
    },

    /** A completion's declaration and documentation, shown beside the list. */
    describe(file: string, pos: number, name: string): Documented | null {
      const details = service.getCompletionEntryDetails(
        `/${file}`,
        pos,
        name,
        undefined,
        undefined,
        undefined,
        undefined,
      );
      if (details === undefined) return null;
      return {
        signature: typescript.displayPartsToString(details.displayParts),
        documentation: typescript.displayPartsToString(details.documentation),
      };
    },

    /** The type of what is at `pos`, and its documentation. */
    quickInfo(file: string, pos: number): QuickInfo | null {
      const info = service.getQuickInfoAtPosition(`/${file}`, pos);
      if (info === undefined) return null;
      return {
        from: info.textSpan.start,
        to: info.textSpan.start + info.textSpan.length,
        signature: typescript.displayPartsToString(info.displayParts),
        documentation: typescript.displayPartsToString(info.documentation),
      };
    },

    /** The errors `tsc` reports in the file. */
    problems(file: string): Problem[] {
      const path = `/${file}`;
      return [
        ...service.getSyntacticDiagnostics(path),
        ...service.getSemanticDiagnostics(path),
      ].map((diagnostic) => {
        const from = diagnostic.start ?? 0;
        return {
          from,
          to: from + (diagnostic.length ?? 0),
          severity:
            diagnostic.category === typescript.DiagnosticCategory.Error
              ? 'error'
              : diagnostic.category === typescript.DiagnosticCategory.Warning
                ? 'warning'
                : 'info',
          message: message(diagnostic.messageText),
        };
      });
    },
  };
}

/**
 * Project scaffolding for the Web runtime's `init` phase: the **user-owned**
 * Web host project, written once under `runtimes/<id>/` and never
 * regenerated.
 *
 * It is part of the project's own JavaScript package: there is no nested
 * `package.json` or lockfile, and nothing names a package manager. Vite comes
 * with `@soundor/web-runtime`, which runs it.
 */

/** A file to scaffold, path relative to the project root. */
export interface ScaffoldFile {
  readonly path: string;
  readonly contents: string;
}

export interface WebScaffoldInput {
  readonly pluginName: string;
  /** From the scaffold directory to `.soundor/generated`, '/'-separated. */
  readonly generatedPath: string;
}

/** The files scaffolded on `init`, under `runtimes/<runtimeId>/`. */
export function webScaffoldFiles(
  runtimeId: string,
  input: WebScaffoldInput,
): ScaffoldFile[] {
  const dir = `runtimes/${runtimeId}`;
  return [
    { path: `${dir}/index.html`, contents: indexHtml(input.pluginName) },
    { path: `${dir}/vite.config.ts`, contents: viteConfig() },
    { path: `${dir}/tsconfig.json`, contents: tsconfig(input.generatedPath) },
    { path: `${dir}/src/main.ts`, contents: mainTs() },
  ];
}

function indexHtml(pluginName: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(pluginName)}</title>
  </head>
  <body>
    <div id="soundor"></div>
    <script type="module" src="./src/main.ts"></script>
  </body>
</html>
`;
}

function viteConfig(): string {
  return `// The Web host's Vite config. When \`soundor dev\` and \`soundor build\` run
// Vite, Soundor adds what the host needs: the plugin's UI bundle, the
// soundor:* modules and the output paths. Add your own Vite settings here.
import { defineWebConfig } from '@soundor/web-runtime/vite';

export default defineWebConfig({});
`;
}

function tsconfig(generatedPath: string): string {
  const generated = (file: string) =>
    JSON.stringify(`${generatedPath}/${file}`);
  return `{
  // The Web host's code runs in the browser: DOM and Web Audio types, and the
  // soundor:* modules declared from soundor.config.
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": [],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": [
    "src",
    ${generated('native.d.ts')},
    ${generated('parameters.d.ts')},
    ${generated('platform.d.ts')}
  ]
}
`;
}

function mainTs(): string {
  return `// The Web host's entry: starts Soundor's Web host for this plugin.
import { startSoundorWebHost } from '@soundor/web-runtime/client';

await startSoundorWebHost();
`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

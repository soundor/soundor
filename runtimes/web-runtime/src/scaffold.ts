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
  /** From `src/` to the generated native contract, without extension. */
  readonly nativeContractPath: string;
  /** The native API's methods, stubbed in the scaffolded native.ts. */
  readonly nativeMethods: readonly {
    readonly name: string;
    readonly async: boolean;
  }[];
  /** Whether the plugin declares a float `gain` parameter to apply. */
  readonly gain: boolean;
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
    {
      path: `${dir}/src/native.ts`,
      contents: nativeTs(input.nativeContractPath, input.nativeMethods),
    },
    { path: `${dir}/src/audio.ts`, contents: audioTs(input.gain) },
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
  return `// The Web host's entry: starts Soundor's Web host for this plugin. The
// plugin's native API and audio load after the host, so their soundor:*
// imports find it ready.
import { startSoundorWebHost } from '@soundor/web-runtime/client';

await startSoundorWebHost({
  native: () => import('./native'),
  audio: () => import('./audio'),
});
`;
}

function nativeTs(
  contractPath: string,
  methods: readonly { readonly name: string; readonly async: boolean }[],
): string {
  const stubs = methods.map(
    (method) =>
      `  ${method.async ? 'async ' : ''}${method.name}() {\n    throw new Error('${method.name}() is not implemented for the Web yet');\n  },\n`,
  );
  return `// The plugin's native API (soundor:native) for the Web, in TypeScript. The
// plugin UI's calls arrive here as they are made: same values, exceptions
// and promises. WebNativeApi is generated from soundor.config, so a method
// added there is a type error here until it is implemented.
import type { WebNativeApi } from '${contractPath}';

export const native: WebNativeApi = ${stubs.length === 0 ? '{}' : `{\n${stubs.join('')}}`};
`;
}

function audioTs(gain: boolean): string {
  if (!gain) {
    return `// The plugin's audio on the Web: plain Web Audio nodes between the host's
// input and output. soundor:parameters and soundor:host work here too.
import type { WebAudioSetup } from '@soundor/web-runtime/client';

export const setupAudio: WebAudioSetup = ({ input, output }) => {
  input.connect(output);
  return () => input.disconnect();
};
`;
  }
  return `// The plugin's audio on the Web: plain Web Audio nodes between the host's
// input and output, here a gain that follows the 'gain' parameter.
// soundor:parameters is the same parameter the plugin UI moves.
import type { WebAudioSetup } from '@soundor/web-runtime/client';
import { parameters } from 'soundor:parameters';

export const setupAudio: WebAudioSetup = ({ context, input, output }) => {
  const gain = context.createGain();
  const follow = (value: number) =>
    gain.gain.setTargetAtTime(value, context.currentTime, 0.01);

  gain.gain.value = parameters.gain.get();
  const unsubscribe = parameters.gain.subscribe(follow);
  input.connect(gain);
  gain.connect(output);

  return () => {
    unsubscribe();
    input.disconnect();
    gain.disconnect();
  };
};
`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

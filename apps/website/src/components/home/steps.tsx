import { File, Files, Folder } from 'fumadocs-ui/components/files';
import { Camera, ListTree, MousePointerClick, Terminal } from 'lucide-react';

import { type FileId, files } from './flow';
import type { Highlighted } from './highlight';
import {
  CodeReveal,
  CommandType,
  GainPreview,
  GainWave,
  Passed,
  phase,
  Reveal,
  Run,
} from './scenes';
import type { WorkflowStep } from './workflow';

/** What DevTools does with the running plugin (see its docs page). */
const devtools = [
  [
    ListTree,
    'Node tree',
    'The real UI hierarchy, searchable, highlighted in the plugin window.',
  ],
  [
    MousePointerClick,
    'Pick and act',
    'Select a control in the window, then click, hover or focus it.',
  ],
  [Camera, 'Screenshots', 'The view as the engine renders it, as a PNG.'],
  [
    Terminal,
    'Console',
    'Logs with source-mapped stacks, filtered and cleared per tab.',
  ],
] as const;

/**
 * A step whose code is written, then runs, then shows its result: the
 * code over the first 45% of the scene, the task to 70%, then the result.
 */
function written(
  code: Record<FileId, Highlighted>,
  id: FileId,
  task: { readonly label: string; readonly done: string },
  result: React.ReactNode,
) {
  return (p: number) => (
    <>
      <CodeReveal
        file={files[id].file}
        code={code[id]}
        shown={phase(p, 0, 0.45)}
      />
      <Run {...task} started={p > 0.45} progress={phase(p, 0.45, 0.7)} />
      <Reveal shown={phase(p, 0.7, 0.85)}>{result}</Reveal>
    </>
  );
}

/**
 * A step that types a command, runs it, then shows its result: the
 * command over the first 25% of the scene, the task to 60%, then the result.
 */
function typed(
  id: FileId,
  task: { readonly label: string; readonly done: string },
  result: React.ReactNode,
) {
  return (p: number) => (
    <>
      <CommandType command={files[id].code} shown={phase(p, 0, 0.25)} />
      <Run {...task} started={p > 0.25} progress={phase(p, 0.25, 0.6)} />
      <Reveal shown={phase(p, 0.6, 0.78)}>{result}</Reveal>
    </>
  );
}

/** The walk's steps, each with its scene. */
export function workflowSteps(
  code: Record<FileId, Highlighted>,
): readonly WorkflowStep[] {
  return [
    {
      title: 'Create a project',
      link: {
        href: '/docs/cli/create-soundor-app',
        text: 'create-soundor-app',
      },
      body: (
        <p>
          One command sets up the config, a React interface and a Rust crate for
          the sound. Choose VST3, the web, or both.
        </p>
      ),
      view: typed(
        'create',
        {
          label: 'Creating my-plugin and installing its dependencies',
          done: 'Created my-plugin',
        },
        <Files className="my-0">
          <Folder name="my-plugin" defaultOpen>
            <File name="soundor.config.ts" />
            <Folder name="src" defaultOpen>
              <File name="App.tsx" />
            </Folder>
            <Folder name="lib/src" defaultOpen>
              <File name="processor.rs" />
            </Folder>
          </Folder>
        </Files>,
      ),
    },
    {
      title: 'Describe the plugin',
      link: { href: '/docs/parameters', text: 'Parameters' },
      body: (
        <p>
          <code>soundor.config.ts</code> names the plugin, its parameters and
          where it runs. Everything after it is typed from it: the processor,
          the interface and the tests all know <code>gain</code> is a number
          from 0 to 1.
        </p>
      ),
      view: written(
        code,
        'config',
        {
          label: 'soundor gen: writing the types',
          done: 'Generated the types',
        },
        <Files className="my-0">
          <Folder name=".soundor/generated" defaultOpen>
            <File name="parameters.d.ts" />
            <File name="native.d.ts" />
            <Folder name="rust/soundor" />
          </Folder>
        </Files>,
      ),
    },
    {
      title: 'Write the sound',
      link: { href: '/docs/rust-processor', text: 'Rust processor' },
      body: (
        <p>
          The processor is Rust and runs on the audio thread. The VST3 plugin
          runs it natively; the browser runs the same crate as WebAssembly in an
          AudioWorklet.
        </p>
      ),
      view: written(
        code,
        'processor',
        { label: 'Compiling lib with Cargo', done: 'Compiled lib' },
        <GainWave />,
      ),
    },
    {
      title: 'Draw the interface',
      link: { href: '/docs/react', text: 'React API' },
      body: (
        <p>
          React components and hooks, laid out with flexbox and drawn by
          Soundor’s own engine, not a browser. Canvas 2D and WebGL are there
          when a knob is not enough.
        </p>
      ),
      view: written(
        code,
        'ui',
        { label: 'Bundling the interface', done: 'Reloaded the interface' },
        <GainPreview />,
      ),
    },
    {
      title: 'Run it and look inside',
      link: { href: '/docs/cli/devtools', text: 'DevTools' },
      body: (
        <>
          <p>
            <code>npm run dev</code> opens the plugin in a VST3 host and reloads
            the interface on every save.
          </p>
          <p>
            DevTools shows its real node tree in your browser: pick a control,
            read its layout, click it, take a screenshot.
          </p>
        </>
      ),
      view: typed(
        'dev',
        {
          label: 'Building the debug plugin',
          done: 'Opened My Plugin in the VST3 host',
        },
        <ul className="divide-y rounded-xl border bg-fd-card text-sm">
          {devtools.map(([Icon, title, text]) => (
            <li key={title} className="flex gap-3 p-3">
              <Icon
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-fd-primary"
              />
              <span>
                <span className="font-medium">{title}</span>
                <span className="block text-fd-muted-foreground">{text}</span>
              </span>
            </li>
          ))}
        </ul>,
      ),
    },
    {
      title: 'Test it the way it is used',
      link: { href: '/docs/testing', text: 'Testing' },
      body: (
        <p>
          Tests run in Node with Vitest, against a simulated runtime: no DAW and
          no build. Find a control by its role and name, click it, and check the
          parameter.
        </p>
      ),
      view: written(
        code,
        'test',
        { label: 'Running 1 test', done: 'Ran 1 test' },
        <Passed file="src/App.test.tsx" name="resets the gain" />,
      ),
    },
    {
      title: 'Test the real plugin',
      link: { href: '/docs/testing/e2e', text: 'End-to-end tests' },
      body: (
        <p>
          End-to-end tests load the built <code>.vst3</code> in the VST3 host
          and check what it shows and what it sounds like, in the same test.
        </p>
      ),
      view: written(
        code,
        'e2e',
        {
          label: 'Launching My Plugin in the VST3 host',
          done: 'Ran 1 test in the VST3 host',
        },
        <Passed
          file="e2e/plugin.test.ts"
          name="reset brings the sound back to half"
        />,
      ),
    },
    {
      title: 'Build both',
      link: { href: '/docs/cli/build', text: 'soundor build' },
      body: (
        <p>
          One command makes the release VST3 bundle in{' '}
          <code>.soundor/dist/vst3/</code> and a static site in{' '}
          <code>.soundor/dist/web/</code>, from the same code.
        </p>
      ),
      view: (p) => (
        <>
          <CommandType command={files.build.code} shown={phase(p, 0, 0.25)} />
          <Run
            label="Building the VST3 plugin"
            done="Built My Plugin.vst3"
            started={p > 0.25}
            progress={phase(p, 0.25, 0.55)}
          />
          <Run
            label="Building the web page"
            done="Built the web page"
            started={p > 0.3}
            progress={phase(p, 0.3, 0.62)}
          />
          <Reveal shown={phase(p, 0.62, 0.8)}>
            <Files className="my-0">
              <Folder name=".soundor/dist" defaultOpen>
                <Folder name="vst3" defaultOpen>
                  <File name="My Plugin.vst3" />
                </Folder>
                <Folder name="web" defaultOpen>
                  <File name="index.html" />
                </Folder>
              </Folder>
            </Files>
          </Reveal>
        </>
      ),
    },
  ];
}

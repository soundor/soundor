import { createFileRoute, Link } from '@tanstack/react-router';
import { HomeLayout } from 'fumadocs-ui/layouts/home';

import { baseOptions } from '@/lib/layout.shared';
import { soundorVersion } from '@/lib/shared';

export const Route = createFileRoute('/')({
  component: Home,
});

const steps = [
  {
    title: 'Declare the plugin once',
    text: 'soundor.config.ts names the plugin, its parameters and a typed native API. Soundor generates the contract every runtime implements.',
  },
  {
    title: 'Write the UI in React',
    text: 'One TypeScript/React UI, with React Native–style components, layout, animations, canvases and accessibility.',
  },
  {
    title: 'Run it in every runtime',
    text: 'A JUCE plugin (VST3, AU, Standalone) with an embedded engine, and the same plugin in the browser with Web Audio.',
  },
];

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-16 px-4 py-16 md:py-24">
        <section className="flex flex-col items-start gap-6">
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
            Audio plugins with a React UI,
            <br />
            written once.
          </h1>
          <p className="max-w-2xl text-lg text-fd-muted-foreground">
            Soundor is a toolchain for audio plugins whose UI is written in
            TypeScript and React and runs, unchanged, in a native JUCE plugin
            and in the browser.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/docs/$"
              params={{ _splat: 'getting-started' }}
              className="rounded-lg bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground"
            >
              Get started
            </Link>
            <Link
              to="/docs/$"
              params={{ _splat: '' }}
              className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-fd-accent"
            >
              Read the docs
            </Link>
          </div>
          <pre className="rounded-lg border bg-fd-card px-4 py-3 text-sm">
            <code>npm create soundor-app@{soundorVersion} my-plugin</code>
          </pre>
          <p className="text-sm text-fd-muted-foreground">
            Soundor is pre-1.0: new projects pin exact versions, and a minor
            release can change APIs.
          </p>
        </section>
        <section className="grid gap-4 md:grid-cols-3">
          {steps.map((step, index) => (
            <div key={step.title} className="rounded-xl border bg-fd-card p-5">
              <div className="mb-2 text-sm text-fd-muted-foreground">
                {index + 1}
              </div>
              <h2 className="mb-2 font-medium">{step.title}</h2>
              <p className="text-sm text-fd-muted-foreground">{step.text}</p>
            </div>
          ))}
        </section>
      </main>
    </HomeLayout>
  );
}

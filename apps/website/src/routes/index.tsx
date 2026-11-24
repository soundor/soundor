import { createFileRoute, Link } from '@tanstack/react-router';
import { Card, Cards } from 'fumadocs-ui/components/card';
import {
  CodeBlock,
  CodeBlockTab,
  CodeBlockTabs,
  CodeBlockTabsList,
  CodeBlockTabsTrigger,
  Pre,
} from 'fumadocs-ui/components/codeblock';
import { buttonVariants } from 'fumadocs-ui/components/ui/button';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import {
  AppWindow,
  ArrowRight,
  AudioWaveform,
  Globe,
  Orbit as OrbitIcon,
  Shapes,
  SlidersHorizontal,
} from 'lucide-react';

import { highlightFlow } from '@/components/home/highlight';
import { workflowSteps } from '@/components/home/steps';
import { Workflow } from '@/components/home/workflow';
import { OrbitDemo } from '@/components/orbit-demo';
import { SiteFooter } from '@/components/site-footer';
import { baseOptions } from '@/lib/layout.shared';
import { soundorVersion } from '@/lib/shared';

export const Route = createFileRoute('/')({
  loader: () => highlightFlow(),
  component: Home,
});

const managers = [
  ['pnpm', `pnpm create soundor-app@${soundorVersion} my-plugin`],
  ['npm', `npm create soundor-app@${soundorVersion} my-plugin`],
] as const;

/** Creating a project, with either package manager Soundor supports. */
function Install({ className }: { readonly className?: string }) {
  return (
    <CodeBlockTabs defaultValue="pnpm" className={className}>
      <CodeBlockTabsList>
        {managers.map(([name]) => (
          <CodeBlockTabsTrigger key={name} value={name}>
            {name}
          </CodeBlockTabsTrigger>
        ))}
      </CodeBlockTabsList>
      {managers.map(([name, command]) => (
        <CodeBlockTab key={name} value={name}>
          <CodeBlock>
            <Pre>
              {/* One line: the code block lays each child of code on its own. */}
              <code>
                <span className="line">
                  <span className="text-fd-muted-foreground select-none">
                    ${' '}
                  </span>
                  {command}
                </span>
              </code>
            </Pre>
          </CodeBlock>
        </CodeBlockTab>
      ))}
    </CodeBlockTabs>
  );
}

function Heading({
  eyebrow,
  title,
  text,
  align = 'center',
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly text: string;
  readonly align?: 'center' | 'left';
}) {
  return (
    <div className={align === 'center' ? 'mb-10 text-center' : 'mb-10'}>
      <p className="mb-2 font-mono text-xs tracking-wider text-fd-primary uppercase">
        {eyebrow}
      </p>
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {title}
      </h2>
      <p
        className={`mt-2 text-fd-muted-foreground ${align === 'center' ? 'mx-auto max-w-xl' : 'max-w-xl'}`}
      >
        {text}
      </p>
    </div>
  );
}

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="relative isolate w-full overflow-x-clip">
        {/* A faint grid behind the hero, as on the other Soundor sites. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[760px] [background-image:linear-gradient(to_right,var(--color-fd-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-fd-border)_1px,transparent_1px)] [background-size:48px_48px] opacity-60 [mask-image:radial-gradient(ellipse_60%_55%_at_50%_0%,black,transparent)]"
        />

        <div className="mx-auto max-w-6xl px-6">
          <section className="flex flex-col items-center pt-20 pb-14 text-center sm:pt-28">
            <Link
              to="/changelog/$"
              params={{ _splat: '' }}
              className="mb-6 inline-flex items-center gap-2 rounded-full border bg-fd-card/80 px-3 py-1 text-xs text-fd-muted-foreground backdrop-blur transition-colors hover:text-fd-foreground"
            >
              <AudioWaveform aria-hidden className="size-3.5 text-fd-primary" />
              Soundor {soundorVersion} · VST3 and the web
              <ArrowRight aria-hidden className="size-3" />
            </Link>
            <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
              Audio plugins with a React UI, in your DAW and the browser
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-balance text-fd-muted-foreground">
              Write the interface in React and TypeScript and the sound in Rust.
              One project builds a VST3 plugin for Linux, macOS and Windows, and
              a web page that runs the same plugin.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                className={buttonVariants({
                  variant: 'primary',
                  className: 'gap-1.5 px-4 py-2.5',
                })}
                to="/docs/$"
                params={{ _splat: 'getting-started' }}
              >
                Get started
                <ArrowRight aria-hidden className="size-4" />
              </Link>
              <a
                className={buttonVariants({
                  variant: 'outline',
                  className: 'px-4 py-2.5',
                })}
                href="#orbit-demo"
              >
                Try our plugin
                <OrbitIcon aria-hidden className="ml-1.5 size-4" />
              </a>
            </div>
            <Install className="mt-8 w-full max-w-lg text-left" />
          </section>

          <section id="workflow" className="scroll-mt-20 border-t py-20">
            <Heading
              eyebrow="Workflow"
              title="From an empty folder to a plugin"
              text="One plugin, all the way through. Follow a gain parameter from its definition to the finished plugin."
            />
            <Workflow steps={workflowSteps(Route.useLoaderData())} />
          </section>

          <section id="orbit-demo" className="scroll-mt-20 border-t py-20">
            <Heading
              eyebrow="Try a plugin made with Soundor"
              title="Meet Orbit"
              text="A three-voice stereo delay, running right here in your browser. Press Play, drag an echo, and hear what you can build."
            />
            <div className="mx-auto max-w-[920px] rounded-xl shadow-2xl shadow-black/10 dark:shadow-black/40">
              <OrbitDemo />
            </div>
            <p className="mx-auto mt-5 max-w-2xl text-center text-sm text-fd-muted-foreground">
              Orbit, running live in the web runtime. The same code builds its
              VST3.{' '}
              <Link
                to="/plugins"
                className="underline underline-offset-4 hover:text-fd-foreground"
              >
                See the plugin
              </Link>
              .
            </p>
          </section>

          <section className="border-t py-20">
            <Heading
              eyebrow="Runtimes"
              title="One plugin, two places to play"
              text="The same interface and the same Rust, run by two runtimes."
            />
            <Cards className="sm:grid-cols-2">
              <Card
                icon={<AppWindow />}
                title="VST3, in your DAW"
                href="/docs/vst3-runtime"
                description="A VST3 bundle for Linux, macOS and Windows. The interface runs in an embedded engine and draws on the GPU; there is no browser inside the plugin."
              />
              <Card
                icon={<Globe />}
                title="Web, in the browser"
                href="/docs/web-runtime"
                description="A static site with the same interface on the page and the Rust compiled to WebAssembly, playing through Web Audio."
              />
            </Cards>
          </section>

          <section className="border-t py-20">
            <Heading
              eyebrow="Libraries"
              title="Made to go with it"
              text="Ready-made controls and icons that run in both runtimes."
            />
            <Cards className="sm:grid-cols-2">
              <Card
                icon={<SlidersHorizontal />}
                title="Soundor Components"
                href="https://components.soundor.dev/"
                external
                description="Knobs, faders, meters and draggable plots that bind to your parameters and speak to screen readers."
              />
              <Card
                icon={<Shapes />}
                title="Soundor Icons"
                href="https://icons.soundor.dev/"
                external
                description="Icons from Lucide, Tabler, Phosphor, Heroicons and Material Symbols, drawn natively in a plugin."
              />
            </Cards>
          </section>

          <section className="border-t py-20">
            <Heading
              eyebrow="FAQ"
              title="A few things you might be wondering"
              text="A few details that are easy to miss when you start."
            />
            <div className="mx-auto grid max-w-4xl gap-3">
              <details className="group rounded-xl border bg-fd-card p-5">
                <summary className="cursor-pointer list-none font-medium marker:hidden [&::-webkit-details-marker]:hidden">
                  Is there a browser inside the VST3 plugin?
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-fd-muted-foreground">
                  No. The VST3 runtime embeds Soundor’s native engine and runs
                  your JavaScript with Hermes. It lays out the interface with
                  Yoga and draws it with Skia; it does not embed a browser.
                </p>
              </details>
              <details className="group rounded-xl border bg-fd-card p-5">
                <summary className="cursor-pointer list-none font-medium marker:hidden [&::-webkit-details-marker]:hidden">
                  Does JavaScript make the audio processing slow?
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-fd-muted-foreground">
                  JavaScript does not process the audio. Your DSP is written in
                  Rust and runs on the audio thread—natively in the VST3, and as
                  WebAssembly in an AudioWorklet on the web. JavaScript runs the
                  interface separately.
                </p>
              </details>
              <details className="group rounded-xl border bg-fd-card p-5">
                <summary className="cursor-pointer list-none font-medium marker:hidden [&::-webkit-details-marker]:hidden">
                  Can the same project run in a browser too?
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-fd-muted-foreground">
                  Yes. One project can build a VST3 and a web app. Both use the
                  same React interface and Rust audio processor, with each
                  runtime adapting them to its platform.
                </p>
              </details>
              <details className="group rounded-xl border bg-fd-card p-5">
                <summary className="cursor-pointer list-none font-medium marker:hidden [&::-webkit-details-marker]:hidden">
                  Can I use regular browser React and CSS for the interface?
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-fd-muted-foreground">
                  The shared plugin UI has no DOM, <code>window</code>, or CSS.
                  It uses Soundor’s React components and object-based styles.
                  The web runtime draws those same UI nodes with browser
                  elements. See the{' '}
                  <a
                    className="text-fd-primary hover:underline"
                    href="/docs/react"
                  >
                    React UI guide
                  </a>
                  .
                </p>
              </details>
              <details className="group rounded-xl border bg-fd-card p-5">
                <summary className="cursor-pointer list-none font-medium marker:hidden [&::-webkit-details-marker]:hidden">
                  Does declaring a parameter automatically change the sound?
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-fd-muted-foreground">
                  No. The config defines the parameter and keeps its type and
                  range consistent, but your Rust processor must read it and
                  apply it to the audio. The scaffold’s gain example shows the
                  connection in the{' '}
                  <a
                    className="text-fd-primary hover:underline"
                    href="/docs/rust-processor"
                  >
                    Rust processor guide
                  </a>
                  .
                </p>
              </details>
              <details className="group rounded-xl border bg-fd-card p-5">
                <summary className="cursor-pointer list-none font-medium marker:hidden [&::-webkit-details-marker]:hidden">
                  Do I need Rust, even for a web-only project?
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-fd-muted-foreground">
                  Yes. Both runtimes build the project’s Rust audio processor;
                  the web runtime compiles it to WebAssembly. The starter
                  project includes a working processor, and{' '}
                  <code>soundor doctor</code> checks the required tools.
                </p>
              </details>
              <details className="group rounded-xl border bg-fd-card p-5">
                <summary className="cursor-pointer list-none font-medium marker:hidden [&::-webkit-details-marker]:hidden">
                  Can I build VST3s for every platform from one machine?
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-fd-muted-foreground">
                  Each VST3 build targets the OS and CPU you’re building on;
                  Soundor doesn’t cross-compile. It supports Linux x64, Windows
                  x64, and macOS for the machine’s CPU. The plugin format is
                  VST3.
                </p>
              </details>
              <details className="group rounded-xl border bg-fd-card p-5">
                <summary className="cursor-pointer list-none font-medium marker:hidden [&::-webkit-details-marker]:hidden">
                  Can I rename a parameter after people use the plugin?
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-fd-muted-foreground">
                  Keep its config key stable: hosts use it to identify saved
                  values and automation, so renaming it can break existing
                  sessions. You can change its <code>label</code> without
                  changing that identity.
                </p>
              </details>
            </div>
          </section>

          <section className="mb-24 overflow-hidden rounded-2xl border bg-fd-card p-8 text-center sm:p-12">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Start your own plugin
            </h2>
            <p className="mx-auto mt-3 max-w-md text-fd-muted-foreground">
              You need Node.js 24 and Rust. VST3 builds also need the platform’s
              linker.
            </p>
            <Install className="mx-auto mt-6 max-w-lg text-left" />
            <Link
              className={buttonVariants({
                variant: 'primary',
                className: 'mt-6 gap-1.5 px-4 py-2.5',
              })}
              to="/docs/$"
              params={{ _splat: 'getting-started' }}
            >
              Follow the guide
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </section>
        </div>
      </main>
      <SiteFooter>
        <p>Soundor is before 1.0: APIs can change between minor releases.</p>
      </SiteFooter>
    </HomeLayout>
  );
}

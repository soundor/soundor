import { createFileRoute, Link } from '@tanstack/react-router';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Braces,
  Code2,
  Layers,
  Terminal,
} from 'lucide-react';

import { OrbitDemo } from '@/components/orbit-demo';
import { baseOptions } from '@/lib/layout.shared';
import { repository, soundorVersion } from '@/lib/shared';

export const Route = createFileRoute('/')({ component: Home });

const workflow = [
  {
    icon: Braces,
    title: 'Define your plugin.',
    text: 'Declare parameters and a typed native API in soundor.config.ts. Generated types keep your UI and host implementations in agreement.',
    url: '/docs/parameters',
    link: 'Parameters & automation',
  },
  {
    icon: Code2,
    title: 'Find your interface.',
    text: 'Compose controls in React and TypeScript. Use layout, animation, Canvas 2D and WebGL. Save a UI change and see it reload.',
    url: '/docs/react',
    link: 'Meet the React API',
  },
  {
    icon: AudioLines,
    title: 'Give it a sound.',
    text: 'Connect the controls to your processor. Use C++ with JUCE for the DAW and a separate Web Audio implementation for the browser.',
    url: '/docs/juce-runtime',
    link: 'Explore the runtimes',
  },
];

function Home() {
  return (
    <HomeLayout {...baseOptions()} className="soundor-home">
      <div className="home-content">
        <section className="home-hero" aria-labelledby="home-title">
          <div className="home-intro">
            <p className="home-eyebrow">
              <span /> A toolkit for plugin makers
            </p>
            <h1 id="home-title">
              Audio plugins <br />
              with a React UI. <br />
              <span>
                Your sound. <br />
                Your interface.
              </span>
            </h1>
            <p className="home-lead">
              Build the interface in TypeScript and React. Run it in a native
              JUCE plugin and in the browser. Bring your own DSP.
            </p>
            <div className="home-hero-actions">
              <Link
                to="/docs/$"
                params={{ _splat: 'getting-started' }}
                className="home-button home-button-primary"
              >
                Get started <ArrowRight size={17} aria-hidden />
              </Link>
              <Link
                to="/docs/$"
                params={{ _splat: '' }}
                className="home-text-link"
              >
                Read the docs <ArrowUpRight size={16} aria-hidden />
              </Link>
            </div>
            <div className="home-targets" aria-label="Supported plugin formats">
              <span>VST3</span>
              <span>Audio Unit</span>
              <span>Standalone</span>
              <span>Web</span>
            </div>
          </div>
          <div className="home-demo">
            <OrbitDemo />
            <p className="home-demo-note">
              <span className="home-note-line" /> This is a real plugin. The
              same React UI runs in the DAW.
            </p>
          </div>
        </section>

        <section className="home-foundation" aria-label="How Soundor works">
          <p>One UI. Two places to play.</p>
          <div>
            <Layers size={18} aria-hidden />
            <span>
              <strong>Native JUCE plugin</strong>
              <span>Embedded engine · no browser in the editor</span>
            </span>
          </div>
          <span className="home-foundation-plus" aria-hidden>
            +
          </span>
          <div>
            <Code2 size={18} aria-hidden />
            <span>
              <strong>Browser experience</strong>
              <span>The same UI · your Web Audio processor</span>
            </span>
          </div>
        </section>

        <section className="home-workflow" aria-labelledby="workflow-title">
          <div className="home-section-heading">
            <p className="home-eyebrow">From an idea to an instrument</p>
            <h2 id="workflow-title">
              A familiar way to build
              <br />
              something that sounds like you.
            </h2>
            <p>
              Soundor connects your interface to the host.
              <br />
              You stay in control of the design and the audio.
            </p>
          </div>
          <div className="home-workflow-grid">
            {workflow.map((step, index) => (
              <article key={step.title}>
                <div className="home-step-top">
                  <step.icon size={23} strokeWidth={1.5} aria-hidden />
                  <span>0{index + 1}</span>
                </div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
                <a href={step.url}>
                  {step.link} <ArrowRight size={15} aria-hidden />
                </a>
              </article>
            ))}
          </div>
        </section>

        <section className="home-start" aria-labelledby="start-title">
          <div>
            <p className="home-eyebrow">Your next plugin starts here</p>
            <h2 id="start-title">Make a little noise.</h2>
            <p>
              Create a project with a working gain control and a JUCE processor
              scaffold. Then make it your own.
            </p>
            <Link
              to="/docs/$"
              params={{ _splat: 'getting-started' }}
              className="home-text-link"
            >
              Follow the getting started guide{' '}
              <ArrowRight size={16} aria-hidden />
            </Link>
          </div>
          <div className="home-terminal">
            <div>
              <Terminal size={15} aria-hidden />
              <span>Create a project</span>
            </div>
            <pre>
              <code>
                <span className="home-shell-prompt" aria-hidden>
                  ${' '}
                </span>
                npm create soundor-app@{soundorVersion} my-plugin
              </code>
            </pre>
            <p>
              Node.js 24 · Native builds need CMake, a C++20 compiler and JUCE.{' '}
              <a href="/docs/getting-started#requirements">
                Requirements <ArrowUpRight size={12} aria-hidden />
              </a>
            </p>
          </div>
        </section>

        <footer className="home-footer">
          <p>
            Soundor <span>·</span> Tools for your next sound.
          </p>
          <p>Pre-1.0. APIs can change between minor releases.</p>
          <a href={repository.url}>
            Build with us on GitHub <ArrowUpRight size={14} aria-hidden />
          </a>
        </footer>
      </div>
    </HomeLayout>
  );
}

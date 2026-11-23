import { createFileRoute, Link } from '@tanstack/react-router';
import { Check, Download, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { LegalPage } from '@/components/legal-page';
import { repository } from '@/lib/shared';

import iconOnDark from '../../../../assets/brand/soundor-icon-on-dark.svg?url';
import icon from '../../../../assets/brand/soundor-icon.svg?url';
// The repository's brand files (assets/brand), offered here as downloads.
import family from '../../../../assets/brand/soundor-logo-family-overview.svg?url';
import logoOnDark from '../../../../assets/brand/soundor-logo-on-dark.svg?url';
import logo from '../../../../assets/brand/soundor-logo.svg?url';

const brandFiles = `${repository.url}/tree/${repository.branch}/assets/brand`;
const brandLicense = `${repository.url}/blob/${repository.branch}/assets/brand/LICENSE.md`;
const issues = `${repository.url}/issues`;

export const Route = createFileRoute('/brand')({
  head: () => ({
    meta: [
      { title: 'Brand Guidelines | Soundor' },
      {
        name: 'description',
        content:
          'How to refer to Soundor, name a project built with it, and use the official logos.',
      },
    ],
  }),
  component: Brand,
});

const projects = [
  {
    name: 'Soundor',
    what: 'The framework: CLI, runtimes, engine and libraries',
    site: 'https://soundor.dev/',
    repo: 'https://github.com/soundor/soundor',
  },
  {
    name: 'Soundor Components',
    what: 'UI components for Soundor plugins',
    site: 'https://components.soundor.dev/',
    repo: 'https://github.com/soundor/components',
  },
  {
    name: 'Soundor Icons',
    what: 'Icon collections for Soundor and the browser',
    site: 'https://icons.soundor.dev/',
    repo: 'https://github.com/soundor/icons',
  },
  {
    name: 'Soundor Orbit',
    what: 'The official audio plugin',
    site: 'https://orbit.soundor.dev/',
    repo: 'https://github.com/soundor/orbit',
  },
];

const assets = [
  {
    name: 'Logo',
    note: 'For light backgrounds',
    file: logo,
    download: 'soundor-logo.svg',
    dark: false,
    wide: true,
  },
  {
    name: 'Logo on dark',
    note: 'For dark backgrounds',
    file: logoOnDark,
    download: 'soundor-logo-on-dark.svg',
    dark: true,
    wide: true,
  },
  {
    name: 'Icon',
    note: 'For light backgrounds',
    file: icon,
    download: 'soundor-icon.svg',
    dark: false,
    wide: false,
  },
  {
    name: 'Icon on dark',
    note: 'For dark backgrounds',
    file: iconOnDark,
    download: 'soundor-icon-on-dark.svg',
    dark: true,
    wide: false,
  },
];

const colors = [
  { name: 'Ink', value: '#10121A' },
  { name: 'Light', value: '#F2F4F7' },
  { name: 'Accent orange', value: '#FF5A1F' },
];

function Rule({ ok, children }: { ok: boolean; children: ReactNode }) {
  const Icon = ok ? Check : X;
  return (
    <li className="flex list-none gap-2 ps-0">
      <Icon
        aria-hidden
        className={`mt-1 size-4 shrink-0 ${ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
      />
      <span>{children}</span>
    </li>
  );
}

function Brand() {
  return (
    <LegalPage
      eyebrow="Brand"
      title="Brand Guidelines"
      lead={
        <p>
          Build anything with Soundor, and say so. Just make it clear what is
          yours and what is official.
        </p>
      }
    >
      <p>
        Soundor is an open-source framework and ecosystem for audio plugins. Its
        software is released under the{' '}
        <a href={`${repository.url}/blob/${repository.branch}/LICENSE`}>
          MIT License
        </a>
        , and we want as many people as possible to build with it, commercially
        or not. These guidelines are about something else: the Soundor name and
        logos, so that people can tell the official project from the many
        projects built with it.
      </p>

      <h2 id="status">What these guidelines are</h2>
      <p>
        Soundor is not a registered trademark. These guidelines are the
        project’s requests to the community, not a claim of exclusive legal
        rights, and they do not take away anything that the MIT License or the
        law already allows you.
      </p>
      <p>
        The logo files are a separate matter: they are original artwork, and the
        copies published with this notice come with their own terms, described
        in{' '}
        <a href={brandLicense}>
          <code>assets/brand/LICENSE.md</code>
        </a>{' '}
        in each repository. In short, you may use them unmodified to refer to
        Soundor, as shown below.
      </p>

      <h2 id="official">Official projects</h2>
      <p>
        These are the official Soundor projects. Anything else built with
        Soundor is independent, which is exactly how it should be.
      </p>
      <div className="not-prose overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b text-fd-muted-foreground">
            <tr>
              <th className="py-2 pe-4 font-medium">Project</th>
              <th className="py-2 pe-4 font-medium">What it is</th>
              <th className="py-2 font-medium">Links</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.name} className="border-b last:border-0">
                <td className="py-2 pe-4 font-medium">{project.name}</td>
                <td className="py-2 pe-4 text-fd-muted-foreground">
                  {project.what}
                </td>
                <td className="py-2 whitespace-nowrap">
                  <a
                    className="underline underline-offset-2 hover:text-fd-primary"
                    href={project.site}
                  >
                    Website
                  </a>
                  {' · '}
                  <a
                    className="underline underline-offset-2 hover:text-fd-primary"
                    href={project.repo}
                  >
                    GitHub
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <img
        src={family}
        alt="The logos of Soundor, Soundor Orbit, Soundor Components and Soundor Icons, on light and dark backgrounds"
        width={1520}
        height={760}
        className="rounded-xl border"
        loading="lazy"
      />

      <h2 id="welcome">You are welcome to</h2>
      <ul className="ps-0">
        <Rule ok>
          Use Soundor commercially, and build proprietary or open-source plugins
          with it.
        </Rule>
        <Rule ok>
          Modify and distribute the software, under the terms of the MIT
          License.
        </Rule>
        <Rule ok>
          Say that your project is <strong>“Built with Soundor”</strong>,{' '}
          <strong>“Powered by Soundor”</strong>, “made with Soundor”, “for
          Soundor” or “compatible with Soundor”.
        </Rule>
        <Rule ok>
          Write about Soundor in documentation, tutorials, articles, courses,
          talks and videos.
        </Rule>
        <Rule ok>
          Use the unmodified logo to link to Soundor or to illustrate something
          about Soundor itself, such as a review or a tutorial.
        </Rule>
      </ul>

      <h2 id="avoid">Please avoid</h2>
      <ul className="ps-0">
        <Rule ok={false}>
          Presenting an independent project as an official Soundor release, for
          example by naming it “Soundor Reverb” or “Soundor Synth”.
        </Rule>
        <Rule ok={false}>
          Implying that Soundor endorses, certifies, sponsors or is affiliated
          with your project, unless we agreed to it.
        </Rule>
        <Rule ok={false}>
          Using the Soundor logos, or a look-alike, as the logo or app icon of
          your own product.
        </Rule>
        <Rule ok={false}>
          Changing the logos (recolouring, distorting, adding to them) in a way
          that could pass for an official variant.
        </Rule>
        <Rule ok={false}>
          Using names, domains, package names or accounts that people could
          mistake for official Soundor ones.
        </Rule>
      </ul>

      <h2 id="naming">Naming your project</h2>
      <p>
        Give your project its own name and its own logo, and mention Soundor
        after it:
      </p>
      <ul>
        <li>
          Good: “Driftwood, a reverb built with Soundor”, “Acme Synth (powered
          by Soundor)”, “soundor-midi-tools: MIDI helpers for Soundor”.
        </li>
        <li>
          Avoid: “Soundor Driftwood”, “SoundorSynth”, “Official Soundor MIDI
          Tools”.
        </li>
      </ul>
      <p>
        If you publish a fork, give it a different name, say that it is based on
        Soundor, and keep the MIT License’s copyright notice, as the license
        requires.
      </p>

      <h2 id="logos">Using the logos</h2>
      <p>
        Use the files as they are: keep their proportions and colours, leave
        clear space around them (at least half the icon’s height), and use the
        “on dark” versions on dark backgrounds. The logo reads best between 32
        and 64 px tall.
      </p>
      <ul className="not-prose grid gap-4 p-0 sm:grid-cols-2">
        {assets.map((asset) => (
          <li
            key={asset.download}
            className="flex list-none flex-col overflow-hidden rounded-xl border"
          >
            <div
              className={`flex h-36 items-center justify-center p-6 ${asset.dark ? 'bg-[#10121A]' : 'bg-[#F2F4F7]'}`}
            >
              <img
                src={asset.file}
                alt=""
                className={asset.wide ? 'h-12 w-auto' : 'h-16 w-auto'}
              />
            </div>
            <div className="flex items-center justify-between gap-2 border-t px-4 py-3 text-sm">
              <div>
                <p className="font-medium">{asset.name}</p>
                <p className="text-fd-muted-foreground">{asset.note}</p>
              </div>
              <a
                href={asset.file}
                download={asset.download}
                aria-label={`Download ${asset.name} (SVG)`}
                className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 hover:bg-fd-accent"
              >
                <Download aria-hidden className="size-4" />
                SVG
              </a>
            </div>
          </li>
        ))}
      </ul>
      <p>
        One-colour and maskable versions, and the social preview images, are in{' '}
        <a href={brandFiles}>
          <code>assets/brand</code>
        </a>{' '}
        on GitHub. Soundor Components, Soundor Icons and Soundor Orbit keep
        their own logos in the same folder of their repositories.
      </p>
      <h3 id="colors">Colours</h3>
      <ul className="not-prose flex flex-wrap gap-3 p-0">
        {colors.map((color) => (
          <li
            key={color.value}
            className="flex list-none items-center gap-2 rounded-lg border py-1.5 ps-1.5 pe-3 text-sm"
          >
            <span
              aria-hidden
              className="size-6 rounded-md border"
              style={{ backgroundColor: color.value }}
            />
            <span className="font-medium">{color.name}</span>
            <code className="text-fd-muted-foreground">{color.value}</code>
          </li>
        ))}
      </ul>

      <h2 id="questions">Questions and permission</h2>
      <p>
        Not sure whether something fits, or want to do something these
        guidelines advise against, such as a partnership or an official
        integration? <a href={issues}>Open an issue on GitHub</a> and ask. For
        privacy matters, see the <Link to="/privacy">Privacy Policy</Link>.
      </p>
    </LegalPage>
  );
}

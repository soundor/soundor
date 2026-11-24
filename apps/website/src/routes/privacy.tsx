import { createFileRoute, Link } from '@tanstack/react-router';

import { LegalPage } from '@/components/legal-page';

/** The address for every privacy question and request. */
const contact = 'privacy@balakin.io';

const githubPrivacy =
  'https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement';
const githubPages =
  'https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#data-collection';

export const Route = createFileRoute('/privacy')({
  head: () => ({
    meta: [
      { title: 'Privacy Policy | Soundor' },
      {
        name: 'description',
        content:
          'How the official Soundor websites and software handle personal data: no analytics, no tracking cookies, no telemetry.',
      },
    ],
  }),
  component: Privacy,
});

function Mail() {
  return <a href={`mailto:${contact}`}>{contact}</a>;
}

function Privacy() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy Policy"
      lead={
        <p>
          Effective <time dateTime="2026-11-23">November 23, 2026</time>
        </p>
      }
    >
      <p>
        Soundor collects as little about you as it can. The official websites
        have no analytics, no advertising and no accounts, and set no tracking
        cookies. The official software sends no telemetry. This policy explains
        the personal data that is still processed, by whom, and what you can do
        about it.
      </p>

      <h2 id="scope">Scope</h2>
      <p>This policy applies to the official Soundor websites:</p>
      <ul>
        <li>
          <a href="https://soundor.dev/">soundor.dev</a>
        </li>
        <li>
          <a href="https://components.soundor.dev/">components.soundor.dev</a>
        </li>
        <li>
          <a href="https://icons.soundor.dev/">icons.soundor.dev</a>
        </li>
        <li>
          <a href="https://orbit.soundor.dev/">orbit.soundor.dev</a>
        </li>
        <li>other official Soundor services that link to this policy</li>
      </ul>
      <p>
        and to the official Soundor software: the Soundor framework (its npm
        packages, CLI, runtimes and engine), Soundor Components, Soundor Icons
        and the Soundor Orbit plugin.
      </p>
      <p>
        It does not cover plugins and apps that other people build with Soundor;
        their developers are responsible for them. Nor does it cover GitHub, npm
        or other services we link to, which have their own policies.
      </p>

      <h2 id="controller">Who is responsible</h2>
      <p>
        Soundor is maintained by Dmitrii Balakin, who is responsible for the
        processing described here (the controller, in the terms of the EU and UK
        General Data Protection Regulation). For anything about privacy, write
        to <Mail />.
      </p>

      <h2 id="data">Data processing at a glance</h2>
      <ul>
        <li>
          <strong>Visiting a website:</strong> the hosting provider, GitHub,
          processes your IP address and request details to deliver the page and
          keep the service secure. We do not receive these logs.
        </li>
        <li>
          <strong>Preferences and demos:</strong> some settings are saved in
          your own browser, never sent to us.
        </li>
        <li>
          <strong>Using the software:</strong> nothing is sent to Soundor.
          Downloads come from GitHub and npm.
        </li>
        <li>
          <strong>Writing to us:</strong> we process your email address and
          message to answer you.
        </li>
      </ul>
      <p>
        You do not have to give us any personal data to use the websites or the
        software. We do not sell or share personal data, build profiles of
        visitors, or make automated decisions about you.
      </p>

      <h2 id="hosting">Website hosting</h2>
      <p>
        The websites are static pages hosted on GitHub Pages, a service of
        GitHub, Inc. When you open a page, your browser connects to GitHub’s
        servers, which receive the technical information every web request
        carries: your IP address, the address of the page, the date and time,
        your browser’s user agent and, where your browser sends it, the page
        that linked to it.{' '}
        <a href={githubPages}>GitHub logs visitors’ IP addresses</a> for
        security purposes, whether or not they are signed in to GitHub.
      </p>
      <p>
        GitHub processes this information to serve the websites and protect them
        and its service, as described in the{' '}
        <a href={githubPrivacy}>GitHub General Privacy Statement</a>, and it may
        process it in the United States and other countries. GitHub Pages gives
        site owners no access to these logs, so we do not see or keep them. The
        legal basis for having the websites hosted this way is our legitimate
        interest in publishing them reliably and securely (Article 6(1)(f)
        GDPR).
      </p>
      <p>
        Every file the websites use (scripts, styles, fonts, images and the live
        examples) is served from the official Soundor websites themselves; the
        soundor.dev home page, for example, shows the Orbit demo from
        orbit.soundor.dev. The pages load nothing from other providers. Links to
        other sites, such as GitHub or npm, take you to services with their own
        privacy policies.
      </p>

      <h2 id="cookies">Cookies and tracking</h2>
      <p>
        The websites set no cookies and use no analytics, advertising, tracking
        pixels, fingerprinting or session recording.
      </p>
      <p>
        Some features save what you chose in your browser’s own storage (local
        storage and IndexedDB), so that it is still there next time:
      </p>
      <ul>
        <li>the colour theme, light or dark;</li>
        <li>the package manager selected in code examples;</li>
        <li>
          the state of the live examples and plugin demos that run in the page,
          such as their parameter values and presets, and the panel around them.
        </li>
      </ul>
      <p>
        This information stays on your device: the websites never send it
        anywhere. It is needed for the features you use, so no consent banner is
        shown. You can delete it at any time by clearing the site’s data in your
        browser.
      </p>
      <p>
        Searching the documentation and editing examples happen in your browser
        too: the search index is downloaded with the site, and neither your
        queries nor your code are sent to us.
      </p>

      <h2 id="software">Official Soundor software</h2>
      <p>
        The Soundor framework, Soundor Components, Soundor Icons and Soundor
        Orbit contain no telemetry, usage analytics or crash reporting, and send
        no information to Soundor.
      </p>
      <ul>
        <li>
          Installing Soundor’s packages downloads them from the npm registry, or
          from whichever registry your package manager uses.
        </li>
        <li>
          Soundor’s build tools download prebuilt parts of the toolchain, such
          as the engine, from GitHub Releases when a build needs them, and
          Soundor Orbit is downloaded from GitHub Releases. These requests go
          directly to GitHub, whose privacy statement applies. GitHub shows us
          only total download counts.
        </li>
        <li>
          Soundor DevTools runs a server on your own computer for the dashboard;
          it is not connected to any Soundor service.
        </li>
      </ul>
      <p>
        A plugin built with Soundor can make network requests of its own.
        Whether it does, and what it sends, is up to its developer, not Soundor.
      </p>

      <h2 id="email">Email correspondence</h2>
      <p>
        When you write to <Mail />, we process your email address, the contents
        of your message and anything else you choose to include, such as your
        name. We use it only to read and answer your message and to handle your
        request, including a request to exercise your privacy rights.
      </p>
      <p>
        The legal basis is our legitimate interest in answering the messages we
        receive (Article 6(1)(f) GDPR) and, for requests about your rights, our
        legal obligation to handle them (Article 6(1)(c) GDPR). Your messages
        are stored by the email provider that hosts the mailbox, which processes
        them on our behalf.
      </p>
      <p>
        We keep correspondence for as long as we need it to deal with your
        message and any follow-up, and then delete it, unless we have to keep it
        longer to meet a legal obligation or to establish, exercise or defend
        legal claims.
      </p>
      <p>
        Issues, pull requests and discussions on GitHub are public, and GitHub’s
        privacy statement applies to them. Please do not post personal
        information there that you want to keep private; write to us instead.
      </p>

      <h2 id="third-parties">Third-party services</h2>
      <p>Soundor relies on these services, each under its own policy:</p>
      <ul>
        <li>
          <strong>GitHub</strong> (GitHub, Inc.): hosting of the websites, the
          source code, releases and issue tracking.{' '}
          <a href={githubPrivacy}>GitHub General Privacy Statement</a>.
        </li>
        <li>
          <strong>npm</strong> (operated by GitHub, Inc.): distribution of the
          packages.{' '}
          <a href="https://docs.npmjs.com/policies/privacy">
            npm Privacy Policy
          </a>
          .
        </li>
      </ul>
      <p>
        We have no advertising, analytics or data-broker partners, and we do not
        give personal data to anyone else unless the law requires it.
      </p>

      <h2 id="retention">Data retention</h2>
      <ul>
        <li>
          <strong>Hosting logs:</strong> kept by GitHub under its own policy; we
          hold none.
        </li>
        <li>
          <strong>Browser storage:</strong> on your device until you or your
          browser delete it.
        </li>
        <li>
          <strong>Email:</strong> as long as needed to handle your message, as
          described above.
        </li>
      </ul>

      <h2 id="rights">Your rights</h2>
      <p>
        Depending on where you live, data protection law gives you rights over
        your personal data. Under the GDPR and the UK GDPR you can ask to:
      </p>
      <ul>
        <li>access the personal data we hold about you, and get a copy;</li>
        <li>have it corrected if it is wrong;</li>
        <li>have it deleted;</li>
        <li>have its processing restricted;</li>
        <li>receive it in a portable format;</li>
        <li>
          object to processing based on our legitimate interests, at any time.
        </li>
      </ul>
      <p>
        To use these rights, write to <Mail />. We may ask for information to
        confirm that a request comes from you, and we answer within the time the
        law sets, normally one month. Because we do not receive GitHub’s hosting
        logs, we cannot access or delete them ourselves; requests about them go
        to GitHub, and we will help you with that.
      </p>
      <p>
        You also have the right to complain to a data protection supervisory
        authority, in particular in the country where you live or work, or where
        you think your rights were infringed. We would appreciate the chance to
        sort out your concern first.
      </p>
      <p>
        Other privacy laws, such as those of US states, give similar rights, and
        you can use them the same way. We do not sell or share personal
        information for advertising.
      </p>

      <h2 id="changes">Changes to this policy</h2>
      <p>
        We will update this page when our practices change, and change the date
        at the top. Every earlier version stays in the{' '}
        <a href="https://github.com/soundor/soundor/commits/main/apps/website/src/routes/privacy.tsx">
          history of this page on GitHub
        </a>
        . If a change affects how we use personal data we already have, we will
        say so here before it takes effect.
      </p>

      <h2 id="contact">Contact</h2>
      <p>
        Questions, requests and complaints about privacy: <Mail />.
      </p>
      <p>
        For how the Soundor name and logos may be used, see the{' '}
        <Link to="/brand">Brand Guidelines</Link>.
      </p>
    </LegalPage>
  );
}

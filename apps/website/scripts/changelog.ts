/** Build docs from Changesets' published history; no second release log to maintain. */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

export interface Change {
  kind: string;
  markdown: string;
}

/** Dependency-only bumps are omitted; multiline release notes stay intact. */
export function parseChangelog(markdown: string): Map<string, Change[]> {
  const releases = new Map<string, Change[]>();
  let changes: Change[] = [];
  let kind = '';
  for (const block of markdown.split(/(?=^## |^### |^- )/m)) {
    const version = /^## (\d+\.\d+\.\d+)\s*$/.exec(block.trim());
    if (version) {
      changes = [];
      kind = '';
      releases.set(version[1]!, changes);
    } else if (block.startsWith('### ')) {
      kind = block.trim().slice(4);
    } else if (
      block.startsWith('- ') &&
      !block.startsWith('- Updated dependencies')
    ) {
      changes.push({ kind, markdown: block.trim() });
    }
  }
  return releases;
}

// MDX treats braces and tags in prose as code. Keep fenced and inline code literal.
function mdxSafe(markdown: string): string {
  return markdown
    .split(/(```[\s\S]*?```|`[^`]*`)/g)
    .map((part, index) =>
      index % 2
        ? part
        : part
            .replaceAll('{', '&#123;')
            .replaceAll('}', '&#125;')
            .replaceAll('<', '&lt;'),
    )
    .join('');
}

type ReleaseChange = Change & { packages?: string[] };

function newestFirst(versions: Iterable<string>): string[] {
  return [...versions].sort((a, b) =>
    b.localeCompare(a, 'en', { numeric: true }),
  );
}

function writeSection(
  out: URL,
  slug: string,
  title: string,
  releases: Map<string, ReleaseChange[]>,
): void {
  const dir = new URL(`${slug}/`, out);
  mkdirSync(dir, { recursive: true });
  const versions = newestFirst(releases.keys());
  const index = [
    '---',
    `title: ${title}`,
    `description: Release history for ${title}.`,
    '---',
    '',
    '[All release histories](/docs/changelog)',
    '',
  ];
  if (!versions.length) index.push('No published release notes yet.', '');
  for (const version of versions) {
    index.push(`- [${version}](/docs/changelog/${slug}/${version})`, '');
    const changes = releases.get(version)!;
    const page = [
      '---',
      `title: ${title} ${version}`,
      `description: Release notes for ${title} ${version}.`,
      '---',
      '',
      `[All ${title} releases](/docs/changelog/${slug})`,
      '',
    ];
    if (!changes.length) page.push('Dependency updates only.', '');
    for (const kind of [...new Set(changes.map((change) => change.kind))]) {
      page.push(`## ${kind || 'Changes'}`, '');
      for (const change of changes.filter((entry) => entry.kind === kind)) {
        page.push(mdxSafe(change.markdown), '');
        if (change.packages) {
          page.push(
            `  **Packages:** ${[...change.packages]
              .sort()
              .map((name) => `\`${name}\``)
              .join(', ')}.`,
            '',
          );
        }
      }
    }
    writeFileSync(new URL(`${version}.md`, dir), page.join('\n'));
  }
  writeFileSync(new URL('index.md', dir), index.join('\n'));
  writeFileSync(
    new URL('meta.json', dir),
    JSON.stringify(
      {
        title,
        collapsible: true,
        defaultOpen: false,
        pages: ['index', ...versions],
      },
      null,
      2,
    ) + '\n',
  );
}

export function generateChangelog(
  root = new URL('../../../', import.meta.url),
  out = new URL('../content/docs/changelog/', import.meta.url),
): void {
  const groups = new Map<string, Map<string, ReleaseChange>>();
  const independent = new Map<
    string,
    { title: string; releases: Map<string, Change[]> }
  >();
  const titles: Record<string, string> = {
    '@soundor/juce-runtime': 'JUCE Runtime',
    '@soundor/web-runtime': 'Web Runtime',
    '@soundor/engine': 'Engine',
    '@soundor/yoga-wasm': 'Yoga WASM',
    '@soundor/vst3-host': 'VST3 Host',
  };
  for (const parent of ['packages', 'runtimes', 'engines', 'hosts']) {
    if (!existsSync(new URL(`${parent}/`, root))) continue;
    for (const dir of readdirSync(new URL(`${parent}/`, root), {
      withFileTypes: true,
    })) {
      if (!dir.isDirectory()) continue;
      const path = `${parent}/${dir.name}/`;
      const file = new URL(`${path}CHANGELOG.md`, root);
      if (!existsSync(new URL(`${path}package.json`, root))) continue;
      const { name } = JSON.parse(
        readFileSync(new URL(`${path}package.json`, root), 'utf8'),
      ) as { name: string };
      const history = existsSync(file) ? readFileSync(file, 'utf8') : '';
      if (!history && !titles[name]) continue;
      const releases = parseChangelog(history);
      const title = titles[name];
      if (title) {
        independent.set(name.replace('@soundor/', ''), { title, releases });
        continue;
      }
      for (const [version, changes] of releases) {
        let release = groups.get(version);
        if (!release) groups.set(version, (release = new Map()));
        for (const { kind, markdown } of changes) {
          const existing = release.get(markdown);
          if (existing) existing.packages!.push(name);
          else release.set(markdown, { kind, markdown, packages: [name] });
        }
      }
    }
  }
  // This directory contains only generated pages, including obsolete versions.
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const sections = [
    {
      slug: 'soundor',
      title: 'Soundor',
      category: 'Packages',
      releases: new Map(
        [...groups].map(([version, changes]) => [
          version,
          [...changes.values()],
        ]),
      ),
    },
    ...Object.keys(titles).flatMap((name) => {
      const slug = name.replace('@soundor/', '');
      const section = independent.get(slug);
      const category = slug.endsWith('-runtime')
        ? 'Runtimes'
        : slug === 'vst3-host'
          ? 'Hosts'
          : 'Engines';
      return section ? [{ slug, category, ...section }] : [];
    }),
  ];
  const index = [
    '---',
    'title: Changelog',
    'description: New features, improvements, and fixes in Soundor.',
    '---',
    '',
    'Browse release notes by category and package, then choose a version. The runtimes, engines and VST3 host have their own version numbers.',
    '',
  ];
  const pages = ['index'];
  for (const category of ['Packages', 'Runtimes', 'Engines', 'Hosts']) {
    const members = sections.filter((section) => section.category === category);
    if (!members.length) continue;
    pages.push(`---${category}---`);
    index.push(`## ${category}`, '');
    for (const { slug, title, releases } of members) {
      writeSection(out, slug, title, releases);
      pages.push(slug);
      index.push(`- [${title}](/docs/changelog/${slug})`);
    }
    index.push('');
  }
  writeFileSync(new URL('index.md', out), index.join('\n'));
  writeFileSync(
    new URL('meta.json', out),
    JSON.stringify(
      {
        title: 'Changelog',
        description: 'What’s new in Soundor',
        root: true,
        pages,
      },
      null,
      2,
    ) + '\n',
  );
}

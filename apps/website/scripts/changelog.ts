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

export function generateChangelog(
  root = new URL('../../../', import.meta.url),
  out = new URL('../content/docs/changelog/', import.meta.url),
): void {
  const groups = new Map<
    string,
    Map<string, { kind: string; packages: string[] }>
  >();
  const independent = new Map<string, { title: string; history: string }>();
  const titles: Record<string, string> = {
    '@soundor/engine': 'Engine',
    '@soundor/web-runtime': 'Web Runtime',
    '@soundor/juce-runtime': 'JUCE Runtime',
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
      const title = titles[name];
      if (title) {
        independent.set(name.replace('@soundor/', ''), {
          title,
          history: history
            .replace(/^# .*\n/, '')
            .replace(/^## /gm, `## ${title} `),
        });
        continue;
      }
      for (const [version, changes] of parseChangelog(history)) {
        let release = groups.get(version);
        if (!release) groups.set(version, (release = new Map()));
        for (const { kind, markdown } of changes) {
          const existing = release.get(markdown);
          if (existing) existing.packages.push(name);
          else release.set(markdown, { kind, packages: [name] });
        }
      }
    }
  }
  // This directory contains only generated pages, including obsolete versions.
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const versions = [...groups.keys()].sort((a, b) =>
    b.localeCompare(a, 'en', { numeric: true }),
  );
  const index = [
    '---',
    'title: Changelog',
    'description: New features, improvements, and fixes in Soundor.',
    '---',
    '',
    'Release notes from the published package changelogs. Changes shared by several packages appear once, with the affected packages listed.',
    '',
    'The runtimes, engines and VST3 host are versioned independently. Browse their release histories:',
    '',
    ...[...independent].map(
      ([slug, { title }]) => `- [${title} releases](/docs/changelog/${slug})`,
    ),
    '',
  ];
  for (const version of versions) {
    index.push(
      `## Soundor ${version}`,
      '',
      `${groups.get(version)!.size} changes across the Soundor packages. [Read release notes](/docs/changelog/${version}).`,
      '',
    );
    const page = [
      '---',
      `title: Soundor ${version}`,
      `description: Release notes for Soundor ${version}.`,
      '---',
      '',
      '[All releases](/docs/changelog)',
      '',
    ];
    for (const kind of [
      'Major Changes',
      'Minor Changes',
      'Patch Changes',
      '',
    ]) {
      const entries = [...groups.get(version)!].filter(
        ([, entry]) => entry.kind === kind,
      );
      if (!entries.length) continue;
      page.push(`## ${kind || 'Changes'}`, '');
      for (const [markdown, entry] of entries) {
        page.push(
          mdxSafe(markdown),
          '',
          `  **Packages:** ${entry.packages
            .sort()
            .map((name) => `\`${name}\``)
            .join(', ')}.`,
          '',
        );
      }
    }
    writeFileSync(new URL(`${version}.md`, out), page.join('\n'));
  }
  writeFileSync(new URL('index.md', out), index.join('\n'));
  for (const [slug, { title, history }] of independent) {
    writeFileSync(
      new URL(`${slug}.md`, out),
      [
        '---',
        `title: ${title} releases`,
        `description: Release notes for the independently versioned Soundor ${title}.`,
        '---',
        '',
        '[All Soundor releases](/docs/changelog)',
        '',
        history ? mdxSafe(history) : 'No published release notes yet.',
      ].join('\n'),
    );
  }
  writeFileSync(
    new URL('meta.json', out),
    JSON.stringify(
      {
        title: 'Changelog',
        description: 'What’s new in Soundor',
        root: true,
        pages: ['index', ...independent.keys(), ...versions],
      },
      null,
      2,
    ) + '\n',
  );
}

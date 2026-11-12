/**
 * The docs' `@since` annotations cover what a release adds: every declaration
 * or interface member of `@soundor/react`'s source and of the runtime-provided
 * `soundor:*` modules (`packages/environment`, whose tables the component,
 * hooks and api pages show) that the last release of its package does not
 * have, carries a doc comment with `@since next` — or, once its release
 * shipped, `@since <version>`, which `scripts/resolve-release.mjs` wrote.
 *
 * CI runs this as a check; a violation names the file, the item and what it
 * needs. The parse is plain text, so what it does not recognize is silently
 * unchecked: an unrecognized form does not fail the check, it only leaves an
 * API without a badge.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The files whose new APIs the docs show, and the package whose tag dates them. */
export const SCOPES = [
  {
    tag: '@soundor/react',
    directory: join(ROOT, 'packages/react/src'),
  },
  {
    tag: '@soundor/environment',
    directory: join(ROOT, 'packages/environment'),
    // Generated, and a reference list with no declarations.
    skip: ['webgl.d.ts', 'index.d.ts'],
  },
];

/** The `/** … *\/` comments, with where each ends. */
function comments(text) {
  return [...text.matchAll(/\/\*\*[\s\S]*?\*\//g)].map((match) => ({
    end: match.index + match[0].length,
    text: match[0],
  }));
}

/** The comment directly before `from`, with only whitespace between. */
function commentFor(all, text, from) {
  for (let index = all.length - 1; index >= 0; index--) {
    const comment = all[index];
    if (comment.end > from) continue;
    return /^\s*$/.test(text.slice(comment.end, from)) ? comment : undefined;
  }
  return undefined;
}

/** The absolute span of the interface body whose declaration starts at `from`. */
function interfaceBody(text, from) {
  const open = text.indexOf('{', from);
  if (open === -1) return undefined;
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === '{') depth++;
    else if (text[index] === '}') {
      depth--;
      if (depth === 0) return { from: open + 1, to: index };
    }
  }
  return undefined;
}

/** The interface's own members, with where each starts. Only its own: a
 * nested object's properties are not what the tables show. */
function members(text, body) {
  const found = [];
  let depth = 1;
  let index = body.from;
  while (index < body.to) {
    let newline = text.indexOf('\n', index);
    if (newline === -1 || newline > body.to) newline = body.to;
    const line = text.slice(index, newline);
    if (depth === 1) {
      // A method's parameter list spans lines at this depth too; its lines
      // end with a comma, a member's never does.
      if (!/,\s*$/.test(line)) {
        const match =
          /^\s{2,}(?:readonly\s+|get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\??\s*[:(]/.exec(
            line,
          );
        if (match) found.push({ name: match[1], from: index });
      }
    }
    for (const char of line) {
      if (char === '{') depth++;
      else if (char === '}') depth--;
    }
    index = newline + 1;
  }
  return found;
}

/**
 * Every declaration and interface member `text` declares, keyed by name (top
 * level) or `interface#member`, each with the doc comment the item shows.
 */
export function declared(text) {
  const all = comments(text);
  const items = new Map();
  const declaration =
    /(?:^|[\n;}{])\s*export\s+(?:declare\s+)?(?:abstract\s+)?(?:default\s+)?(interface|type|class|enum|const|let|var|function)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of text.matchAll(declaration)) {
    const [, keyword, name] = match;
    items.set(name, {
      comment: commentFor(all, text, match.index)?.text ?? '',
    });
    if (keyword !== 'interface') continue;
    const body = interfaceBody(text, match.index);
    if (body === undefined) continue;
    for (const member of members(text, body))
      items.set(`${name}#${member.name}`, {
        comment: commentFor(all, text, member.from)?.text ?? '',
      });
  }
  return items;
}

/** Whether two version strings order the same way as versions do. */
export function compareVersions(a, b) {
  const parts = (version) =>
    version
      .split(/[.-]/)
      .map((part) => (Number.isNaN(Number(part)) ? part : Number(part)));
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const one = left[index];
    const other = right[index];
    // A version that ran out of parts is the release; one still listing
    // prerelease parts is older.
    if (one === undefined) return 1;
    if (other === undefined) return -1;
    if (one === other) continue;
    // Numeric identifiers always have lower precedence than alphanumeric
    // ones, as semver compares prerelease parts.
    if (typeof one !== typeof other) return typeof one === 'number' ? -1 : 1;
    return one < other ? -1 : 1;
  }
  return 0;
}

/** The newest `tag@version` git knows, or undefined when there is none. */
export function newestTag(tag) {
  const tags = execFileSync('git', ['tag', '--list', `${tag}@*`], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .map((name) => name.slice(tag.length + 1))
    .sort(compareVersions);
  return tags.at(-1) === undefined ? undefined : `${tag}@${tags.at(-1)}`;
}

function fileAtTag(tag, path) {
  try {
    return execFileSync(
      'git',
      ['show', `${tag}:${path.slice(ROOT.length + 1)}`],
      // A file the tag predates is new: git says so on stderr, and its
      // baseline is empty.
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    return undefined;
  }
}

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(?:d\.)?tsx?$/.test(entry) && !/\.test\./.test(entry))
      files.push(path);
  }
  return files;
}

/** What `file` gained since `tag`: the items no annotated baseline has. */
export function violations(tag, text, baselineText) {
  const baseline = declared(baselineText ?? '');
  const found = [];
  for (const [name, { comment }] of declared(text ?? '')) {
    if (baseline.has(name) || /@since\s+\S/.test(comment)) continue;
    found.push(name);
  }
  return found;
}

function main() {
  const problems = [];
  for (const scope of SCOPES) {
    const tag = newestTag(scope.tag);
    if (tag === undefined) {
      console.error(`${scope.tag} has no tag; its scope is not checked.`);
      continue;
    }
    for (const file of sourceFiles(scope.directory)) {
      if (scope.skip?.some((skipped) => file.endsWith(skipped))) continue;
      const text = readFileSync(file, 'utf8');
      for (const name of violations(tag, text, fileAtTag(tag, file)))
        problems.push(
          `${file.slice(ROOT.length + 1)}: ${name} — added since ${tag}; its doc comment needs "@since next".`,
        );
    }
  }
  if (problems.length === 0) {
    console.log('Every API the docs show is annotated with @since.');
    return;
  }
  console.error(
    `${problems.length} API${problems.length === 1 ? '' : 's'} the docs show have no @since:\n${problems.join('\n')}`,
  );
  process.exitCode = 1;
}

if (
  process.argv[1] !== undefined &&
  process.argv[1].endsWith('check-since.mjs')
)
  main();

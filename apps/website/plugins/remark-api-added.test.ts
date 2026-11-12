import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStringifier } from 'fumadocs-core/mdx-plugins/stringifier';
import type { Root } from 'mdast';
import { VFile } from 'vfile';
import { afterAll, describe, expect, it } from 'vitest';

import { apiVersion } from './api-added.ts';
import { remarkApiAdded } from './remark-api-added.ts';

const directory = mkdtempSync(join(tmpdir(), 'soundor-api-added-'));
const path = join(directory, 'api.d.ts');
writeFileSync(
  path,
  `declare module 'soundor:test' {
    /** The released API. @since 0.17.0 */
    export const released: string;
    /** The next API. @since next */
    export function pending(): void;
    export interface Undated {}
  }`,
);
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function render(name: string) {
  const content = `<ApiAdded path="${path}" name="${name}" />`;
  const tree = {
    type: 'root',
    children: [
      {
        type: 'mdxJsxFlowElement',
        name: 'ApiAdded',
        attributes: [
          { type: 'mdxJsxAttribute', name: 'path', value: path },
          { type: 'mdxJsxAttribute', name: 'name', value: name },
        ],
        children: [],
        position: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: content.length + 1, offset: content.length },
        },
      },
    ],
  } as unknown as Root;
  const file = new VFile({ path: 'docs/api.mdx', value: content });
  remarkApiAdded()(tree, file);
  return {
    ...tree,
    markdown: createStringifier(file).slice(0, content.length),
  };
}

describe('API release metadata', () => {
  it('reads ambient constant and function annotations from source', () => {
    expect(apiVersion(path, 'released')).toBe('0.17.0');
    expect(apiVersion(path, 'pending')).toBe('next');
  });

  it('emits readable paragraphs for released and unreleased APIs', () => {
    expect(render('released').children[0]).toMatchObject({
      type: 'paragraph',
      data: { hProperties: { className: ['api-added'] } },
      children: [{ type: 'text', value: 'Added in: v0.17.0' }],
    });
    expect(render('pending').children[0]).toMatchObject({
      children: [{ value: 'Added in: next release' }],
    });
    expect(render('released').markdown).toBe('Added in: v0.17.0');
    expect(render('pending').markdown).toBe('Added in: next release');
  });

  it('rejects stale source references and missing annotations', () => {
    expect(() => render('Missing')).toThrow(
      'there is no declaration named Missing',
    );
    expect(() => render('Undated')).toThrow('Undated has no @since annotation');
  });
});

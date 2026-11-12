import assert from 'node:assert/strict';
// The @since parser, on fixture sources: what it declares, and what a new
// item needs for the docs to date it.
import { describe, it } from 'node:test';

import { compareVersions, declared, violations } from './check-since.mjs';

describe('declared', () => {
  it('finds exported declarations with the comment before them', () => {
    const items = declared(`
      /** A button. */
      export interface ButtonProps {
        /** What it says. */
        label: string;
        disabled?: boolean;
      }
      export type Size = 'small' | 'large';
      export const VERSION = 1;
      export function press() {}
    `);
    assert.deepEqual(
      [...items.keys()],
      [
        'ButtonProps',
        'ButtonProps#label',
        'ButtonProps#disabled',
        'Size',
        'VERSION',
        'press',
      ],
    );
    assert.match(items.get('ButtonProps').comment, /A button/);
    assert.match(items.get('ButtonProps#label').comment, /What it says/);
    assert.equal(items.get('ButtonProps#disabled').comment, '');
  });

  it('finds declarations inside declare module blocks', () => {
    const items = declared(`
      declare module 'soundor:ui' {
        /** The node. */
        export interface UiNode {
          /** Where it is. */
          readonly x: number;
        }
      }
    `);
    assert.deepEqual([...items.keys()], ['UiNode', 'UiNode#x']);
  });

  it("doesn't take a nested object's properties for members", () => {
    const items = declared(`
      export interface Deep {
        opts: {
          nested: 1;
        };
      }
    `);
    assert.deepEqual([...items.keys()], ['Deep', 'Deep#opts']);
  });

  it("doesn't take a method's parameters for members", () => {
    const items = declared(`
      export interface WithMethods {
        transaction(
          label: string,
          callback: () => void,
        ): void;
        undo(): void;
      }
    `);
    assert.deepEqual(
      [...items.keys()],
      ['WithMethods', 'WithMethods#transaction', 'WithMethods#undo'],
    );
  });

  it('ignores re-exports and local declarations', () => {
    const items = declared(`
      export { Button } from './button';
      export * from './pressable';
      function local() {}
      const alsoLocal = 1;
    `);
    assert.deepEqual([...items.keys()], []);
  });
});

describe('violations', () => {
  const baseline = `
    /** Old. */
    export interface Old {
      /** Its field. */
      field: string;
    }
  `;

  it('needs @since on what the baseline lacks, and nothing else', () => {
    const current = `${baseline}
      /** New. @since next */
      export interface New {
        /** Its field. @since next */
        field: number;
      }
      export interface Old {
        /** New member. @since next */
        extra: string;
      }
    `;
    assert.deepEqual(violations('tag', current, baseline), []);
  });

  it('names what has no annotation', () => {
    const current = `${baseline}
      export interface Bare {
        naked: 1;
      }
      export interface Old {
        extra: string;
      }
    `;
    assert.deepEqual(violations('tag', current, baseline), [
      'Bare',
      'Bare#naked',
      'Old#extra',
    ]);
  });

  it("doesn't take an earlier comment for a member of its own", () => {
    const current = `${baseline}
      export interface Old {
        field: string;
        /** Between. */
        other: 1;
      }
    `;
    // `other` is new and has a comment of its own — without @since, still
    // called out.
    assert.deepEqual(violations('tag', current, baseline), ['Old#other']);
    const annotated = `${current.replace('/** Between. */', '/** Between. @since next */')}`;
    assert.deepEqual(violations('tag', annotated, baseline), []);
  });

  it('takes an empty baseline as everything new', () => {
    const current = `
      /** Whole file. */
      export interface Fresh {}
    `;
    assert.deepEqual(violations('tag', current, undefined), ['Fresh']);
    assert.deepEqual(violations('tag', current, ''), ['Fresh']);
  });
});

describe('compareVersions', () => {
  it('orders numerically, prereleases last within their version', () => {
    assert.equal(compareVersions('0.9.0', '0.16.0'), -1);
    assert.equal(compareVersions('0.16.0', '0.16.0'), 0);
    assert.equal(compareVersions('1.0.0', '0.16.0'), 1);
    assert.equal(compareVersions('0.17.0-next.1', '0.17.0'), -1);
  });
});

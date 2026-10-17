import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import ts from 'typescript-6';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { exampleTypes, LIB_DIR } from '../../scripts/types.ts';
import {
  createLanguageService,
  type ExampleTypes,
} from './language-service.ts';

let root: string;
let types: ExampleTypes;

function write(file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

const APP = `import { View } from '@soundor/react';
import { parameters } from 'soundor:parameters';

export const gain: number = parameters.gain.value;
export const view = View;
`;

/**
 * An example, as pnpm lays one out: its packages are links to where they
 * live, outside it.
 */
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'example-types-'));
  write(
    'packages/react/package.json',
    JSON.stringify({ name: '@soundor/react', types: 'index.d.ts' }),
  );
  write(
    'packages/react/index.d.ts',
    '/** A box laid out with flexbox. */\nexport declare function View(props: { label?: string }): null;\n',
  );
  write(
    'example/tsconfig.app.json',
    `{
      // Comments, as tsconfig files have them.
      "compilerOptions": {
        "lib": ["ES2023"], "types": [], "module": "ESNext",
        "moduleResolution": "bundler", "strict": true, "noEmit": true,
        "composite": true, "tsBuildInfoFile": "./node_modules/.tmp/app.tsbuildinfo"
      },
      "include": ["src", ".soundor/generated/soundor.d.ts"]
    }`,
  );
  write('example/package.json', JSON.stringify({ name: 'example' }));
  write(
    'example/.soundor/generated/soundor.d.ts',
    "declare module 'soundor:parameters' {\n  export const parameters: { readonly gain: { readonly value: number } };\n}\n",
  );
  write('example/src/App.ts', APP);
  mkdirSync(join(root, 'example/node_modules/@soundor'), { recursive: true });
  symlinkSync(
    join(root, 'packages/react'),
    join(root, 'example/node_modules/@soundor/react'),
  );
  types = exampleTypes(join(root, 'example'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('exampleTypes', () => {
  it('has the declarations the check reads, at their paths in the example', () => {
    expect(types.roots).toEqual(['/.soundor/generated/soundor.d.ts']);
    expect(Object.keys(types.files)).toEqual(
      expect.arrayContaining([
        '/.soundor/generated/soundor.d.ts',
        '/node_modules/@soundor/react/index.d.ts',
        '/node_modules/@soundor/react/package.json',
        `${LIB_DIR}/lib.es2023.d.ts`,
        `${LIB_DIR}/lib.es5.d.ts`,
      ]),
    );
  });

  it("leaves out the code, which the editor has, and the build's options", () => {
    expect(types.files['/src/App.ts']).toBeUndefined();
    expect(types.options).toMatchObject({
      strict: true,
      preserveSymlinks: true,
    });
    expect(types.options).not.toHaveProperty('composite');
    expect(types.options).not.toHaveProperty('tsBuildInfoFile');
  });
});

describe('createLanguageService', () => {
  const service = () => createLanguageService(ts, types, { 'src/App.ts': APP });

  it('reports no problems in code that checks', () => {
    expect(service().problems('src/App.ts')).toEqual([]);
  });

  it('reports what tsc reports, where it is', () => {
    const editor = service();
    const code = `${APP}export const name: string = gain;\n`;
    editor.update('src/App.ts', code);
    const [problem] = editor.problems('src/App.ts');
    expect(problem).toMatchObject({
      severity: 'error',
      message: "Type 'number' is not assignable to type 'string'.",
    });
    expect(code.slice(problem?.from, problem?.to)).toBe('name');
  });

  it("completes members from the soundor:* modules' declarations", () => {
    const editor = service();
    const code = `${APP}parameters.`;
    editor.update('src/App.ts', code);
    const list = editor.complete('src/App.ts', code.length, false);
    expect(list?.from).toBe(code.length);
    expect(list?.options.map((option) => option.label)).toEqual(['gain']);
  });

  it("completes a linked package's exports", () => {
    const editor = service();
    const code = `import { V } from '@soundor/react';\n`;
    editor.update('src/App.ts', code);
    const pos = code.indexOf('V }') + 1;
    const list = editor.complete('src/App.ts', pos, false);
    expect(list?.from).toBe(pos - 1);
    expect(list?.options).toContainEqual(
      expect.objectContaining({ label: 'View', type: 'function' }),
    );
    expect(editor.describe('src/App.ts', pos, 'View')).toEqual({
      signature: 'function View(props: {\n    label?: string;\n}): null',
      documentation: 'A box laid out with flexbox.',
    });
  });

  it('completes nothing after a space, unless asked', () => {
    const editor = service();
    const code = `${APP}const x = `;
    editor.update('src/App.ts', code);
    expect(editor.complete('src/App.ts', code.length, false)).toBeNull();
    expect(
      editor
        .complete('src/App.ts', code.length, true)
        ?.options.map((option) => option.label),
    ).toContain('gain');
  });

  it('describes what is under the pointer', () => {
    const pos = APP.indexOf('View;');
    expect(service().quickInfo('src/App.ts', pos)).toMatchObject({
      from: pos,
      to: pos + 'View'.length,
      documentation: 'A box laid out with flexbox.',
    });
  });
});

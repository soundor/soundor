import { describe, expect, it } from 'vitest';

import { CodeError, compile, run } from './modules.ts';

/** The error `action` throws (the test fails if it throws none). */
function thrown(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('expected it to throw');
}

const jsx = {
  jsx: (type: unknown, props: unknown) => ({ type, props }),
  jsxs: (type: unknown, props: unknown) => ({ type, props }),
  Fragment: 'Fragment',
};

describe('run', () => {
  it('runs TypeScript and JSX, with the libraries it is given', () => {
    const exports = run(
      {
        'src/main.tsx': `
          import { View } from '@soundor/react';
          import { gain } from 'soundor:parameters';
          const label: string = 'Gain';
          export const element = <View label={label}>{gain}</View>;
        `,
      },
      'src/main.tsx',
      {
        'react/jsx-runtime': jsx,
        '@soundor/react': { View: 'View' },
        'soundor:parameters': { gain: 0.5 },
      },
    ) as { element: unknown };
    expect(exports.element).toEqual({
      type: 'View',
      props: { label: 'Gain', children: 0.5 },
    });
  });

  it("resolves the project's own files, with or without extensions", () => {
    const exports = run(
      {
        'src/main.tsx': `
          import { App } from './App';
          import { name } from './ui/index';
          import { size } from './ui/size.ts';
          export default App + name + size;
        `,
        'src/App.tsx': `export const App = 'App:';`,
        'src/ui/index.ts': `export { name } from '../names';`,
        'src/names.ts': `export const name = 'name:';`,
        'src/ui/size.ts': `export const size = 3;`,
      },
      'src/main.tsx',
      {},
    ) as { default: string };
    expect(exports.default).toBe('App:name:3');
  });

  it('gives an imported image its asset id, as the bundle does', () => {
    const exports = run(
      {
        'src/snippets/image.tsx': `
          import cover from '../assets/cover.png';
          export default cover;
        `,
      },
      'src/snippets/image.tsx',
      {},
      { 'src/assets/cover.png': '0123456789abcdef.png' },
    ) as { default: string };
    expect(exports.default).toBe('0123456789abcdef.png');
  });

  it('evaluates each file once, and handles cycles as CommonJS does', () => {
    let evaluated = 0;
    const exports = run(
      {
        'src/main.ts': `import { a } from './a'; import { b } from './b'; export const both = a + b;`,
        'src/a.ts': `import { count } from 'count'; count(); export const a = 1;`,
        'src/b.ts': `import { a } from './a'; export const b = a + 1;`,
      },
      'src/main.ts',
      { count: { count: () => evaluated++ } },
    ) as { both: number };
    expect(exports.both).toBe(3);
    expect(evaluated).toBe(1);
  });

  it('says which library is missing, and which ones there are', () => {
    expect(() =>
      run(
        // Used: TypeScript drops imports that are never used.
        {
          'src/main.ts': `import lodash from 'lodash'; export default lodash;`,
        },
        'src/main.ts',
        { react: {}, 'soundor:ui': {} },
      ),
    ).toThrow(
      "'lodash' is not available here: the playground provides react, soundor:ui",
    );
  });

  it('says which file is missing, from where', () => {
    const error = thrown(() =>
      run(
        { 'src/main.ts': `import { App } from './Ap'; export default App;` },
        'src/main.ts',
        {},
      ),
    );
    expect((error as CodeError).located).toBe(
      "src/main.ts: Cannot find './Ap'",
    );
  });

  it('fails on an entry that does not exist', () => {
    expect(() => run({}, 'src/main.tsx', {})).toThrow(
      'There is no src/main.tsx to run',
    );
  });

  it("lets the code's own errors through", () => {
    expect(() =>
      run({ 'src/main.ts': `throw new TypeError('boom');` }, 'src/main.ts', {}),
    ).toThrow(TypeError);
  });
});

describe('compile', () => {
  it('locates a syntax error in the file', () => {
    const error = thrown(() =>
      compile('src/App.tsx', 'const a = 1;\nconst b = ;\nconst c = 2;\n'),
    );
    expect(error).toBeInstanceOf(CodeError);
    expect((error as CodeError).located).toMatch(
      /^src\/App\.tsx:2:\d+: Unexpected token/,
    );
  });
});

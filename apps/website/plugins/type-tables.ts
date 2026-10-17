/**
 * The props tables `<auto-type-table>` makes in MDX, from the real types
 * (fumadocs-typescript, on TypeScript's own checker): a component page's
 * table is its props interface, with each prop's doc comment.
 *
 * One TypeScript project, `@soundor/react`'s, with the `soundor:*`
 * declarations it compiles against loaded too: they are ambient, so
 * nothing imports them by path.
 */

import { join } from 'node:path';

import {
  createGenerator,
  createProject,
  type GenerateOptions,
} from 'fumadocs-typescript';

/** The repository's root: `path` in `<auto-type-table>` starts there. */
export const REPOSITORY = join(import.meta.dirname, '../../..');

const RUNTIME_TYPES = ['globals.d.ts', 'ui.d.ts'].map((file) =>
  join(REPOSITORY, 'packages/core/runtime', file),
);

/** Types this short show in full, not as their kind ('union', 'object'). */
const SHORT_TYPE = 40;

/** How a table shows types: `boolean`, not `union`, while they are short. */
export const typeTableOptions: GenerateOptions & { basePath: string } = {
  basePath: REPOSITORY,
  typeSimplifier: {
    override: ({ checker, type, location }) => {
      // An optional prop's type has `undefined` in it; the table says
      // optional already.
      const text = checker
        .typeToString(type, location)
        .replace(/ \| undefined$/, '')
        .replace(/^undefined \| /, '');
      return text.length <= SHORT_TYPE ? text : undefined;
    },
  },
};

export async function typeTableGenerator() {
  const project = await createProject({
    tsconfigPath: join(REPOSITORY, 'packages/react/tsconfig.app.json'),
  });
  for (const file of RUNTIME_TYPES) {
    if (project.getSourceFile(file) === undefined) {
      throw new Error(`${file} did not load into the type tables' project`);
    }
  }
  return {
    generator: createGenerator({ project }),
    close: () => project.close(),
  };
}

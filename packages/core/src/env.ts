import { SoundorError } from './errors';

/** Explicit public values embedded in JavaScript; never the whole process environment. */
export type EnvironmentValues = Readonly<
  Record<string, string | boolean | number>
>;
export type EnvironmentMode = 'development' | 'production';

/** Shared by config validation and build tools. */
export function environmentIssues(
  values: EnvironmentValues,
): { path: string; message: string }[] {
  return Object.entries(values).flatMap(([key, value]) => {
    const path = `env.${key}`;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      return [
        {
          path,
          message:
            'expected an environment key containing letters, digits and underscores, not starting with a digit',
        },
      ];
    if (['DEV', 'PROD', 'MODE'].includes(key))
      return [{ path, message: 'reserved built-in environment key' }];
    if (
      typeof value !== 'string' &&
      typeof value !== 'boolean' &&
      !(typeof value === 'number' && Number.isFinite(value))
    )
      return [{ path, message: 'expected a string, boolean or finite number' }];
    return [];
  });
}

export function resolveEnvironment(
  values: EnvironmentValues = {},
  mode: EnvironmentMode = 'development',
) {
  const issues = environmentIssues(values);
  if (issues.length)
    throw new SoundorError('Invalid build environment.', {
      code: 'CONFIG',
      issues,
    });
  const entries = Object.entries(values).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return Object.freeze(
    Object.fromEntries([
      ['DEV', mode === 'development'],
      ['PROD', mode === 'production'],
      ['MODE', mode],
      ...entries,
    ]),
  ) as EnvironmentValues & {
    readonly DEV: boolean;
    readonly PROD: boolean;
    readonly MODE: EnvironmentMode;
  };
}

/** Both UI bundling and Vite use the same serialization, including special property names. */
export function renderEnvironmentModule(
  values: EnvironmentValues = {},
  mode: EnvironmentMode = 'development',
): string {
  const json = JSON.stringify(resolveEnvironment(values, mode));
  return `export const env = Object.freeze(JSON.parse(${JSON.stringify(json)}));\n`;
}

/** Custom values get primitive types, without exposing their values in declarations. */
export function renderEnvironmentDts(values: EnvironmentValues = {}): string {
  const fields = Object.keys(values)
    .sort()
    .map((key) => `    readonly ${JSON.stringify(key)}: ${typeof values[key]};`)
    .join('\n');
  return fields
    ? `\ndeclare module 'soundor:env' {\n  export interface Environment {\n${fields}\n  }\n}\n`
    : '';
}

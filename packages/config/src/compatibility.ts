/**
 * Runtime compatibility: whether a runtime supports the host that loads it.
 * The one implementation every entry point uses, through `resolveRuntime`.
 */

import {
  CORE_VERSION,
  RuntimeCompatibilityError,
  isValidRange,
  parseVersion,
  satisfiesRange,
  type SoundorIssue,
} from '@soundor/core';

import type { Runtime, RuntimeCompatibility, RuntimePackage } from './runtime';
import { CONFIG_SCHEMA_VERSION, CONFIG_VERSION } from './version';

/** The versions a host offers its runtimes. */
export interface HostVersions {
  /** The `@soundor/config` that parses the config and drives the phases. */
  readonly config: string;
  /** The `@soundor/core` behind the context and errors runtimes receive. */
  readonly core: string;
  /** The config schema it validates. */
  readonly schema: number;
}

/** This copy's: what `soundor` reports, through its `@soundor/config`. */
export const HOST_VERSIONS: HostVersions = {
  config: CONFIG_VERSION,
  core: CORE_VERSION,
  schema: CONFIG_SCHEMA_VERSION,
};

/**
 * `'compatible'` when the runtime declares support for `host`;
 * `'undeclared'` for a runtime that declares nothing (made before
 * declarations existed), which the host runs with a warning.
 */
export type RuntimeCompatibilityStatus = 'compatible' | 'undeclared';

/**
 * Checks a runtime's declared compatibility against `host`. Throws {@link
 * RuntimeCompatibilityError}: `INCOMPATIBLE_RUNTIME` when it excludes a host
 * version, `INVALID_RUNTIME` when the declaration cannot be read. Never
 * treats an unreadable declaration as either.
 */
export function checkRuntimeCompatibility(
  runtime: Runtime,
  host: HostVersions = HOST_VERSIONS,
): RuntimeCompatibilityStatus {
  const declared: unknown = runtime.package;
  if (declared === undefined) return 'undeclared';

  const problems = declarationProblems(declared);
  const label = runtimeLabel(runtime);
  if (problems.length > 0) {
    throw new RuntimeCompatibilityError(
      `Runtime ${label} declares its compatibility in a form soundor cannot read.`,
      {
        runtimeId: runtime.id,
        code: 'INVALID_RUNTIME',
        issues: problems,
        hint: `The runtime's package must declare it as defineRuntime's \`package\`: { name, version, compatibility: { config, core, schemas } }, with version ranges such as '>=0.16.0 <0.17.0'. Report it to the runtime's authors.`,
      },
    );
  }

  const { name, compatibility } = declared as RuntimePackage;
  const issues: SoundorIssue[] = [];
  if (!satisfiesRange(host.config, compatibility.config)) {
    issues.push({
      path: '',
      message: `@soundor/config ${host.config}: the runtime supports ${compatibility.config}`,
    });
  }
  if (!satisfiesRange(host.core, compatibility.core)) {
    issues.push({
      path: '',
      message: `@soundor/core ${host.core}: the runtime supports ${compatibility.core}`,
    });
  }
  if (!compatibility.schemas.includes(host.schema)) {
    issues.push({
      path: '',
      message: `config schema ${host.schema}: the runtime supports ${compatibility.schemas.join(', ')}`,
    });
  }
  if (issues.length > 0) {
    throw new RuntimeCompatibilityError(
      `Runtime ${label} does not support this project's Soundor version.`,
      {
        runtimeId: runtime.id,
        issues,
        hint: `Upgrade ${name} to a version that supports @soundor/config ${host.config}, or use soundor and @soundor/config at a version it supports.`,
      },
    );
  }
  return 'compatible';
}

/** The warning a host shows for a runtime that declares no compatibility. */
export function undeclaredCompatibilityWarning(
  runtime: Runtime,
  host: HostVersions = HOST_VERSIONS,
): string {
  return `Runtime '${runtime.id}' declares no compatibility, so soundor cannot check that it supports @soundor/config ${host.config} and config schema ${host.schema}. Runtimes declare it as defineRuntime's \`package\` (from @soundor/runtime-sdk 0.17.0); a later Soundor release will refuse runtimes without it.`;
}

function runtimeLabel(runtime: Runtime): string {
  const declared: Partial<Record<'name' | 'version', unknown>> | undefined =
    runtime.package;
  return typeof declared?.name === 'string' &&
    typeof declared.version === 'string'
    ? `'${runtime.id}' (${declared.name}@${declared.version})`
    : `'${runtime.id}'`;
}

/** Every way `value` is not a {@link RuntimePackage}. */
function declarationProblems(value: unknown): SoundorIssue[] {
  const issues: SoundorIssue[] = [];
  const add = (path: string, message: string): void => {
    issues.push({ path, message });
  };
  if (typeof value !== 'object' || value === null) {
    add('package', 'expected an object { name, version, compatibility }');
    return issues;
  }
  const record = value as Record<string, unknown>;
  if (typeof record['name'] !== 'string' || record['name'] === '')
    add('package.name', 'expected the package name');
  if (
    typeof record['version'] !== 'string' ||
    parseVersion(record['version']) === undefined
  )
    add('package.version', 'expected a version such as 0.16.0');
  const compatibility = record['compatibility'];
  if (typeof compatibility !== 'object' || compatibility === null) {
    add('package.compatibility', 'expected { config, core, schemas }');
    return issues;
  }
  const declared = compatibility as Partial<
    Record<keyof RuntimeCompatibility, unknown>
  >;
  for (const key of ['config', 'core'] as const) {
    const range = declared[key];
    if (typeof range !== 'string' || !isValidRange(range))
      add(
        `package.compatibility.${key}`,
        `expected a version range such as '>=0.16.0 <0.17.0', got ${JSON.stringify(range)}`,
      );
  }
  const schemas = declared.schemas;
  if (
    !Array.isArray(schemas) ||
    schemas.length === 0 ||
    !schemas.every((schema) => Number.isInteger(schema) && schema > 0)
  )
    add(
      'package.compatibility.schemas',
      `expected a non-empty list of config schema versions, got ${JSON.stringify(schemas)}`,
    );
  return issues;
}

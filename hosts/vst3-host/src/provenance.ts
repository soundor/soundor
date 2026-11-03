// What every built executable is recorded with (soundor-vst3-host.json in a
// CI artifact and in each platform package): enough to tell whether a binary
// is the one a version, a checkout or a retry expects.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { PROTOCOL_VERSION } from './protocol.ts';

export const PROVENANCE_FILE = 'soundor-vst3-host.json';

export interface Provenance {
  format: 1;
  name: '@soundor/vst3-host';
  version: string;
  protocol: number;
  target: string;
  architectures: string[];
  configuration: 'Release';
  /** The commit it was built from (CI), or null for a local build. */
  sourceCommit: string | null;
  /** nativeInputs() of the sources it was built from. */
  sourceFingerprint: string;
  executable: { path: string; sha256: string; size: number };
  /** Linux: the newest glibc symbol version the executable needs. */
  glibc?: string;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256File(path: string): string {
  return sha256(readFileSync(path));
}

/** The newest GLIBC_x.y version an ELF executable references. */
export function requiredGlibc(bytes: Uint8Array): string | undefined {
  const text = Buffer.from(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).toString('latin1');
  let newest: number[] | undefined;
  for (const match of text.matchAll(/GLIBC_(\d+)\.(\d+)(?:\.(\d+))?/g)) {
    const version = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
    if (
      !newest ||
      version[0]! > newest[0]! ||
      (version[0] === newest[0] &&
        (version[1]! > newest[1]! ||
          (version[1] === newest[1] && version[2]! > newest[2]!)))
    )
      newest = version;
  }
  if (!newest) return undefined;
  return newest[2] ? newest.join('.') : `${newest[0]}.${newest[1]}`;
}

/** The problems with a provenance record, empty when it is well-formed. */
export function provenanceProblems(value: unknown): string[] {
  const p = value as Partial<Provenance> | null;
  const problems: string[] = [];
  if (p === null || typeof p !== 'object') return ['it is not an object'];
  if (p.format !== 1) problems.push(`format is ${p.format}, not 1`);
  if (p.name !== '@soundor/vst3-host') problems.push(`name is ${p.name}`);
  if (typeof p.version !== 'string') problems.push('version is missing');
  if (typeof p.protocol !== 'number') problems.push('protocol is missing');
  if (typeof p.target !== 'string') problems.push('target is missing');
  if (!Array.isArray(p.architectures))
    problems.push('architectures are missing');
  if (p.configuration !== 'Release')
    problems.push(`configuration is ${p.configuration}, not Release`);
  if (p.sourceCommit !== null && !/^[0-9a-f]{40}$/.test(p.sourceCommit ?? ''))
    problems.push('sourceCommit is not a full commit hash');
  if (!/^[0-9a-f]{64}$/.test(p.sourceFingerprint ?? ''))
    problems.push('sourceFingerprint is not a SHA-256');
  if (
    typeof p.executable?.path !== 'string' ||
    !/^[0-9a-f]{64}$/.test(p.executable.sha256 ?? '') ||
    typeof p.executable.size !== 'number'
  )
    problems.push('executable is not { path, sha256, size }');
  return problems;
}

export function checkedProvenance(value: unknown, where: string): Provenance {
  const problems = provenanceProblems(value);
  if (problems.length)
    throw new Error(
      `${where} is not a valid host provenance record: ${problems.join('; ')}`,
    );
  return value as Provenance;
}

/** Whether a binary is interchangeable with what is expected: the same
    version, target, protocol and native inputs. The commit may differ (a
    later commit that left the native inputs alone builds the same thing). */
export function sameIdentity(
  actual: Provenance,
  expected: Pick<Provenance, 'version' | 'target' | 'sourceFingerprint'> & {
    protocol?: number;
  },
): boolean {
  return (
    actual.version === expected.version &&
    actual.target === expected.target &&
    actual.protocol === (expected.protocol ?? PROTOCOL_VERSION) &&
    actual.sourceFingerprint === expected.sourceFingerprint
  );
}

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { integrityOf } from '../../src/npm.ts';
import {
  PROVENANCE_FILE,
  type Provenance,
  sha256,
} from '../../src/provenance.ts';
import { type Target, packageRoot, targetFor } from '../../src/targets.ts';

export const COMMIT = 'a3f91c2d'.padEnd(40, '0');

export function temporary(prefix = 'vst3-host-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** A copy of the package's native inputs (and what else the code reads). */
export function packageCopy(
  directory = temporary(),
  version = '0.3.0',
): string {
  for (const path of [
    'CMakeLists.txt',
    'CMakePresets.json',
    'protocol.json',
    'cmake',
    'native',
    'README.md',
    'LICENSE',
    'NOTICE.md',
  ])
    cpSync(join(packageRoot, path), join(directory, path), { recursive: true });
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({
      name: '@soundor/vst3-host',
      version,
      repository: {
        type: 'git',
        url: 'git+https://github.com/soundor/soundor.git',
        directory: 'hosts/vst3-host',
      },
    }),
  );
  return directory;
}

export const here: Target = targetFor()!;

/** A staged artifact, as `release.ts stage` writes one. */
export function artifact(
  directory: string,
  target: Target,
  fields: Partial<Provenance> & { bytes?: Buffer } = {},
): Provenance {
  const bytes =
    fields.bytes ?? Buffer.from(`#!/bin/sh\necho ${target.target}\n`);
  mkdirSync(join(directory, dirname(target.executable)), { recursive: true });
  writeFileSync(join(directory, target.executable), bytes);
  chmodSync(join(directory, target.executable), 0o755);
  mkdirSync(join(directory, 'licenses', 'vst3sdk'), { recursive: true });
  writeFileSync(
    join(directory, 'licenses', 'vst3sdk', 'LICENSE.txt'),
    'MIT License\n',
  );
  const { bytes: _, ...rest } = fields;
  const provenance: Provenance = {
    format: 1,
    name: '@soundor/vst3-host',
    version: '0.3.0',
    protocol: 1,
    target: target.target,
    architectures: target.architectures,
    configuration: 'Release',
    sourceCommit: COMMIT,
    sourceFingerprint: 'f'.repeat(64),
    executable: {
      path: target.executable,
      sha256: sha256(bytes),
      size: bytes.length,
    },
    ...rest,
  };
  writeFileSync(join(directory, PROVENANCE_FILE), JSON.stringify(provenance));
  return provenance;
}

/** npm pack of a directory with a package.json. */
export function npmPack(directory: string, out: string): string {
  mkdirSync(out, { recursive: true });
  const [{ filename }] = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--pack-destination', out], {
      cwd: directory,
      encoding: 'utf8',
    }),
  ) as [{ filename: string }];
  return join(out, filename);
}

export interface FakeRegistry {
  url: string;
  /** name@version → tarball bytes. */
  versions: Map<string, Buffer>;
  /** Answer every request with this status instead. */
  failWith?: number;
  requests: string[];
  close(): Promise<void>;
}

/** Just enough of the npm registry: version metadata and tarballs. */
export async function fakeRegistry(): Promise<FakeRegistry> {
  const registry: FakeRegistry = {
    url: '',
    versions: new Map(),
    requests: [],
    close: async () => {},
  };
  const server = createServer((request, response) => {
    const path = decodeURIComponent(request.url ?? '');
    registry.requests.push(path);
    if (registry.failWith) {
      response.writeHead(registry.failWith).end();
      return;
    }
    const tarball = /^\/tarballs\/(.+)$/.exec(path);
    if (tarball) {
      const bytes = registry.versions.get(tarball[1]!);
      if (bytes) response.writeHead(200).end(bytes);
      else response.writeHead(404).end();
      return;
    }
    const match = /^\/(@[^/]+\/[^/]+)\/([^/]+)$/.exec(path);
    const key = match ? `${match[1]}@${match[2]}` : '';
    const bytes = registry.versions.get(key);
    if (!match || !bytes) {
      response
        .writeHead(404, { 'content-type': 'application/json' })
        .end('{"error":"Not found"}');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        name: match[1],
        version: match[2],
        dist: {
          tarball: `${registry.url}/tarballs/${encodeURIComponent(key)}`,
          integrity: integrityOf(bytes),
        },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  registry.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  registry.close = () =>
    new Promise((resolve) => server.close(() => resolve()));
  return registry;
}

// Resolve the immutable npm version's manifest for a workspace without one.
// Only small metadata is fetched here; CMake downloads/verifies native archives.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { engineInputs } from './engine-inputs.mjs';

function checkedManifest(value, version) {
  if (
    value.format !== 1 ||
    value.engineVersion !== version ||
    !Array.isArray(value.artifacts)
  )
    throw new Error(`Invalid prebuilt manifest for @soundor/engine ${version}`);
  if (
    value.sourceFingerprint !== undefined &&
    !/^[0-9a-f]{64}$/.test(value.sourceFingerprint)
  )
    throw new Error('Invalid engine input fingerprint in prebuilt manifest');
  return value;
}

// Read one regular file without extracting the npm archive onto the filesystem.
export function packageManifest(tarball) {
  const tar = gunzipSync(tarball, { maxOutputLength: 128 * 1024 * 1024 });
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.toString('utf8', 0, 100).split('\0')[0];
    const size = Number.parseInt(
      header.toString('ascii', 124, 136).replaceAll('\0', '').trim(),
      8,
    );
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      offset + 512 + size > tar.length
    )
      throw new Error('Invalid engine npm archive');
    if (
      name === 'package/artifacts/manifest.json' &&
      [0, 48].includes(header[156])
    )
      return JSON.parse(
        tar.toString('utf8', offset + 512, offset + 512 + size),
      );
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return null; // Older published engines did not carry a manifest.
}

export async function releasedManifest(root, cache, fetcher = fetch) {
  const { version } = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8'),
  );
  if (
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      version,
    )
  )
    throw new Error(`Invalid engine version: ${version}`);
  const bundled = join(root, 'artifacts/manifest.json');
  const cached = join(cache, 'engine-manifests', `${version}.json`);
  for (const path of [bundled, cached]) {
    if (existsSync(path))
      return {
        path,
        value: checkedManifest(JSON.parse(readFileSync(path, 'utf8')), version),
      };
  }
  const request = async (url) => {
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok && response.status !== 404)
      throw new Error(`HTTP ${response.status}: ${url}`);
    return response;
  };
  const response = await request(
    `https://registry.npmjs.org/@soundor%2fengine/${encodeURIComponent(version)}`,
  );
  if (response.status === 404) return null; // An unpublished workspace version.
  const pkg = await response.json();
  if (
    pkg.name !== '@soundor/engine' ||
    pkg.version !== version ||
    !pkg.dist?.integrity?.startsWith('sha512-')
  )
    throw new Error(
      'Engine npm metadata has no matching version and SHA-512 integrity',
    );
  const url = new URL(pkg.dist.tarball);
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org')
    throw new Error(
      'Engine npm archive must come from https://registry.npmjs.org',
    );
  const archive = await request(url.href);
  if (!archive.ok)
    throw new Error(`Engine npm archive is missing: ${url.href}`);
  const bytes = Buffer.from(await archive.arrayBuffer());
  const expected = Buffer.from(pkg.dist.integrity.slice(7), 'base64');
  const actual = createHash('sha512').update(bytes).digest();
  if (expected.length !== actual.length || !timingSafeEqual(actual, expected))
    throw new Error('Engine npm archive failed its SHA-512 integrity check');
  const value = packageManifest(bytes);
  if (value === null) return null;
  checkedManifest(value, version);
  mkdirSync(join(cache, 'engine-manifests'), { recursive: true });
  const partial = `${cached}.${randomUUID()}.part`;
  writeFileSync(partial, JSON.stringify(value));
  renameSync(partial, cached);
  return { path: cached, value };
}

export async function selectEngine(root, cache, { manifest, fetcher } = {}) {
  const { fingerprint } = engineInputs(root);
  const version = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8'),
  ).version;
  const released = manifest
    ? {
        path: manifest,
        value: checkedManifest(
          JSON.parse(readFileSync(manifest, 'utf8')),
          version,
        ),
      }
    : await releasedManifest(root, cache, fetcher);
  if (released?.value.sourceFingerprint === fingerprint)
    return {
      mode: 'prebuilt',
      fingerprint,
      manifest: released.path,
      reason: 'engine inputs match the prebuilt',
    };
  if (manifest)
    throw new Error(
      'The explicitly supplied engine manifest does not match this checkout',
    );
  return {
    mode: 'source',
    fingerprint,
    reason: released
      ? 'engine inputs differ from the release (or it predates input fingerprints)'
      : 'this engine version has no published prebuilt',
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(
      JSON.stringify(
        await selectEngine(process.argv[2], process.argv[3], {
          manifest: process.argv[4] || undefined,
        }),
      ),
    );
  } catch (error) {
    console.error(
      `Engine selection failed: ${error.message}. Use explicit source mode to build offline without release metadata.`,
    );
    process.exitCode = 1;
  }
}

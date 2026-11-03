// The small part of npm the host needs without npm itself: a version's
// metadata, its tarball checked against the registry's SHA-512 integrity,
// and files read out of the tarball without extracting it.
import { createHash, timingSafeEqual } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export const NPM_REGISTRY = 'https://registry.npmjs.org';

export type Fetch = typeof fetch;

export interface VersionMetadata {
  name: string;
  version: string;
  dist: { tarball: string; integrity: string };
  optionalDependencies?: Record<string, string>;
}

/** Never "missing" for anything but the registry's 404: a network,
    authentication or server error is an error. */
export class RegistryError extends Error {
  override readonly name = 'RegistryError';
  readonly status: number | undefined;
  constructor(message: string, status?: number, options?: ErrorOptions) {
    super(message, options);
    this.status = status;
  }
}

export function versionUrl(
  registry: string,
  name: string,
  version: string,
): string {
  return `${registry.replace(/\/$/, '')}/${name.replace('/', '%2f')}/${encodeURIComponent(version)}`;
}

/** The version's metadata, or null when the registry says it does not exist. */
export async function versionMetadata(
  name: string,
  version: string,
  {
    registry = NPM_REGISTRY,
    fetcher = fetch,
  }: { registry?: string; fetcher?: Fetch } = {},
): Promise<VersionMetadata | null> {
  const url = versionUrl(registry, name, version);
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new RegistryError(
      `could not reach ${url}: ${(error as Error).message}`,
      undefined,
      {
        cause: error,
      },
    );
  }
  if (response.status === 404) return null;
  if (!response.ok)
    throw new RegistryError(
      `${url} answered HTTP ${response.status}`,
      response.status,
    );
  let metadata: VersionMetadata;
  try {
    metadata = (await response.json()) as VersionMetadata;
  } catch (error) {
    throw new RegistryError(`${url} did not answer JSON`, response.status, {
      cause: error,
    });
  }
  if (
    metadata.name !== name ||
    metadata.version !== version ||
    !metadata.dist?.integrity?.startsWith('sha512-') ||
    typeof metadata.dist.tarball !== 'string'
  )
    throw new RegistryError(
      `${url} has no ${name}@${version} with a SHA-512 integrity`,
    );
  return metadata;
}

export function integrityOf(bytes: Uint8Array): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

export function matchesIntegrity(
  bytes: Uint8Array,
  integrity: string,
): boolean {
  if (!integrity.startsWith('sha512-')) return false;
  const expected = Buffer.from(integrity.slice(7), 'base64');
  const actual = createHash('sha512').update(bytes).digest();
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** The version's tarball, verified against its metadata's integrity. */
export async function downloadTarball(
  metadata: VersionMetadata,
  {
    registry = NPM_REGISTRY,
    fetcher = fetch,
  }: { registry?: string; fetcher?: Fetch } = {},
): Promise<Buffer> {
  const url = new URL(metadata.dist.tarball);
  const allowed = new URL(registry);
  if (url.protocol !== allowed.protocol || url.host !== allowed.host)
    throw new RegistryError(
      `${metadata.name}'s tarball must come from ${allowed.origin}, not ${url.origin}`,
    );
  let response: Response;
  try {
    response = await fetcher(url.href, {
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw new RegistryError(
      `could not download ${url.href}: ${(error as Error).message}`,
      undefined,
      {
        cause: error,
      },
    );
  }
  if (!response.ok)
    throw new RegistryError(
      `${url.href} answered HTTP ${response.status}`,
      response.status,
    );
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!matchesIntegrity(bytes, metadata.dist.integrity))
    throw new RegistryError(
      `${metadata.name}@${metadata.version}'s tarball failed its SHA-512 integrity check`,
    );
  return bytes;
}

export interface TarEntry {
  /** Without npm's "package/" prefix. */
  path: string;
  mode: number;
  type: 'file' | 'directory' | 'other';
  data: Buffer;
}

/** Every entry of a gzipped tarball (ustar with pax path records, as npm
    writes them). Links and devices are reported as "other". */
export function readTarball(
  gzipped: Uint8Array,
  maxBytes = 512 * 1024 * 1024,
): TarEntry[] {
  const tar = gunzipSync(gzipped, { maxOutputLength: maxBytes });
  const entries: TarEntry[] = [];
  let paxPath: string | undefined;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start: number, length: number) =>
      header.toString('utf8', start, start + length).split('\0')[0]!;
    const size = Number.parseInt(field(124, 12).trim() || '0', 8);
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      offset + 512 + size > tar.length
    )
      throw new Error('the tarball is truncated or corrupt');
    const typeFlag = String.fromCharCode(header[156]!);
    const data = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (typeFlag === 'x') {
      const match = /\d+ path=([^\n]*)\n/.exec(data.toString('utf8'));
      paxPath = match?.[1];
      continue;
    }
    if (typeFlag === 'g') continue;
    const prefix = field(345, 155);
    let path =
      paxPath ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    paxPath = undefined;
    path = path.replace(/^package\//, '');
    entries.push({
      path,
      mode: Number.parseInt(field(100, 8).trim() || '0', 8),
      type:
        typeFlag === '0' || typeFlag === '\0'
          ? 'file'
          : typeFlag === '5'
            ? 'directory'
            : 'other',
      data: Buffer.from(data),
    });
  }
  return entries;
}

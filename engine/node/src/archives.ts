/**
 * `@soundor/engine/archives`: how engine() keeps verified release archives
 * in the Soundor cache, for first-party tooling that ships its own prebuilt
 * archives the same way (the VST3 runtime's adapters). Not a stable API.
 *
 * - {@link cacheRoot}: SOUNDOR_CACHE, else the user cache directory.
 * - {@link installArchive}: an archive downloaded once (https: or file:),
 *   checked against its SHA-256 and size, and extracted whole into
 *   `<cache>/<directory>/<sha256>/<top>/`; concurrent callers wait for each
 *   other. Fails with a `SoundorEngineError` (`download`, `artifact`).
 *
 * @module
 */

export { cacheRoot } from './cache.ts';
export type { EngineErrorCode } from './errors.ts';
export type { Fetch } from './manifest.ts';
export { type ArchiveEntry, installArchive } from './prebuilt.ts';

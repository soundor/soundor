/**
 * Code signing, shared by every runtime. A config may name a signing identity
 * (`signing.macos.identity`); the environment overrides it; ad-hoc signing is
 * the default. {@link resolveSigning} applies that precedence once, so every
 * runtime reads the same {@link SigningContext} from its lifecycle context and
 * none re-reads the environment.
 *
 * Soundor never handles key material: an identity is only the *name* of a
 * certificate whose private key lives in the macOS keychain, which `codesign`
 * looks up itself.
 */

import { ConfigError } from './errors';
import type { SoundorConfig } from './types';

/** Overrides `signing.macos.identity`. */
export const MACOS_SIGNING_IDENTITY_ENV = 'SOUNDOR_MACOS_SIGNING_IDENTITY';
/** A keychain `codesign` searches in addition to the default search list. */
export const MACOS_KEYCHAIN_ENV = 'SOUNDOR_MACOS_KEYCHAIN';
/** `codesign`'s ad-hoc identity: a signature without a certificate. */
export const AD_HOC_IDENTITY = '-';

/** Where the resolved macOS identity came from. */
export type MacosSigningSource = 'env' | 'config' | 'default';

/** The macOS signing a runtime applies to every binary it produces. */
export interface MacosSigning {
  /**
   * The identity to pass to `codesign --sign`: a certificate's name (e.g.
   * `Developer ID Application: Acme (ABCDE12345)`), its SHA-1 hash, or
   * {@link AD_HOC_IDENTITY}.
   */
  readonly identity: string;
  readonly source: MacosSigningSource;
  /** A keychain to search for the identity (`codesign --keychain`). */
  readonly keychain?: string;
}

/** Resolved signing settings, one entry per platform. */
export interface SigningContext {
  readonly macos: MacosSigning;
}

/**
 * Why `value` cannot be a signing identity, or `undefined` when it can. An
 * identity is a single line naming a certificate; anything resembling an
 * exported key or certificate is rejected so it never sits in a config.
 */
export function checkSigningIdentity(value: string): string | undefined {
  if (value.trim() === '') return 'expected a non-empty signing identity';
  if (
    /[\r\n]/.test(value) ||
    value.includes('-----BEGIN') ||
    value.length > 256
  ) {
    return (
      'expected the name or SHA-1 hash of a certificate in your keychain, ' +
      "e.g. 'Developer ID Application: Acme (ABCDE12345)'; this looks like key material, " +
      'which never belongs in a config or a Soundor variable'
    );
  }
  return undefined;
}

/**
 * Resolves the signing settings: `SOUNDOR_MACOS_SIGNING_IDENTITY`, then
 * `signing.macos.identity`, then ad-hoc. Throws {@link ConfigError} when the
 * environment holds something that is not an identity.
 */
export function resolveSigning(
  config: Pick<SoundorConfig, 'signing'>,
  env: NodeJS.ProcessEnv = process.env,
): SigningContext {
  const fromEnv = nonEmpty(env[MACOS_SIGNING_IDENTITY_ENV]);
  if (fromEnv !== undefined) {
    const problem = checkSigningIdentity(fromEnv);
    if (problem !== undefined) {
      throw new ConfigError('validation', 'Invalid signing identity.', [
        { path: MACOS_SIGNING_IDENTITY_ENV, message: problem },
      ]);
    }
  }
  const fromConfig = config.signing?.macos?.identity;
  const keychain = nonEmpty(env[MACOS_KEYCHAIN_ENV]);
  const [identity, source]: [string, MacosSigningSource] =
    fromEnv !== undefined
      ? [fromEnv, 'env']
      : fromConfig !== undefined
        ? [fromConfig, 'config']
        : [AD_HOC_IDENTITY, 'default'];
  return {
    macos: {
      identity,
      source,
      ...(keychain !== undefined ? { keychain } : {}),
    },
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

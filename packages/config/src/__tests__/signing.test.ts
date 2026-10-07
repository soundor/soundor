import { describe, expect, it } from 'vitest';

import { ConfigError } from '../errors';
import { resolveSigning } from '../signing';

const identity = 'Developer ID Application: Acme (ABCDE12345)';

describe('resolveSigning', () => {
  it('signs ad-hoc when nothing names an identity', () => {
    expect(resolveSigning({}, {})).toEqual({
      macos: { identity: '-', source: 'default' },
    });
  });

  it('uses the identity from the config', () => {
    expect(resolveSigning({ signing: { macos: { identity } } }, {})).toEqual({
      macos: { identity, source: 'config' },
    });
  });

  it('lets the environment override the config', () => {
    expect(
      resolveSigning(
        { signing: { macos: { identity: 'Apple Development: Me (TEAM)' } } },
        { SOUNDOR_MACOS_SIGNING_IDENTITY: ` ${identity} ` },
      ),
    ).toEqual({ macos: { identity, source: 'env' } });
  });

  it('ignores empty variables', () => {
    expect(
      resolveSigning(
        { signing: { macos: { identity } } },
        { SOUNDOR_MACOS_SIGNING_IDENTITY: '', SOUNDOR_MACOS_KEYCHAIN: ' ' },
      ),
    ).toEqual({ macos: { identity, source: 'config' } });
  });

  it('passes a keychain through', () => {
    expect(
      resolveSigning(
        {},
        {
          SOUNDOR_MACOS_SIGNING_IDENTITY: identity,
          SOUNDOR_MACOS_KEYCHAIN: '/tmp/ci.keychain-db',
        },
      ),
    ).toEqual({
      macos: { identity, source: 'env', keychain: '/tmp/ci.keychain-db' },
    });
  });

  it('rejects key material in the environment', () => {
    let caught: unknown;
    try {
      resolveSigning(
        {},
        { SOUNDOR_MACOS_SIGNING_IDENTITY: '-----BEGIN CERTIFICATE-----' },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).issues).toEqual([
      expect.objectContaining({ path: 'SOUNDOR_MACOS_SIGNING_IDENTITY' }),
    ]);
  });
});

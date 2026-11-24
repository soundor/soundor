import type { UserConfig } from 'tsdown';

export { browser } from './browser.ts';
export { node } from './node.ts';
export { thirdPartyNotices, type NoticesPlugin } from './notices.ts';

export function withPreset(preset: UserConfig, config: UserConfig): UserConfig {
  return {
    ...preset,
    ...config,
  };
}

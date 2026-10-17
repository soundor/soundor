import type { SiteValues } from './placeholders';

declare const __SITE_VALUES__: SiteValues;

/**
 * The placeholder values, as the build recorded them (`define` in
 * `vite.config.ts`), for code that runs in the site.
 */
export const siteValues: SiteValues = __SITE_VALUES__;

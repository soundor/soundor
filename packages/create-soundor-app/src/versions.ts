/** Recorded at build time: see `template-versions.ts`. */
declare const __TEMPLATE_VERSIONS__: Readonly<Record<string, string>>;

/** The version each of the template's dependencies gets, by name. */
export const TEMPLATE_VERSIONS: Readonly<Record<string, string>> =
  __TEMPLATE_VERSIONS__;

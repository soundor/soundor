import type { Locator, Vst3Plugin } from '@soundor/vitest-e2e';

/** A parameter's normalized value, as the host reads it. */
export const normalized = (plugin: Vst3Plugin, title: string) => async () =>
  (await plugin.parameter(title).get()).normalized;

/** A node's text, for `expect.poll`. */
export const textOf = (locator: Locator) => async () =>
  (await locator.getNode()).text;

/** What an adjustable says its value is, as a screen reader hears it. */
export const valueText = (locator: Locator) => async () => {
  const { value } = await locator.getAccessibility();
  return (value as { text?: string } | undefined)?.text;
};

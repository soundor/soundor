import {
  loadUserSettings,
  type DevToolsSettings,
  type Runtime,
  type UserConfigOptions,
} from '@soundor/config';

/** Discover support without running a lifecycle or reading unsupported settings. */
export async function resolveDevToolsSettings(
  runtime: Runtime,
  options?: UserConfigOptions,
): Promise<DevToolsSettings | undefined> {
  if (runtime.capabilities?.devtools === undefined) return undefined;
  const { devtools } = await loadUserSettings(options);
  return devtools.enabled ? devtools : undefined;
}

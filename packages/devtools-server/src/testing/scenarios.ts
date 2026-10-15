import type { DevToolsServer, DevToolsConnection } from '../server';
import { startSimulatedBrowser } from './browser';
import { startSimulatedRuntime } from './simulated-runtime';

export const scenarioNames = [
  'gain-plugin',
  'empty',
  'multiple-targets',
  'limited-capabilities',
  'disconnected',
  'reload',
  'lease-conflict',
] as const;
export type ScenarioName = (typeof scenarioNames)[number];

/** Leases belong to the real server: open two tabs in lease-conflict. */
export async function startScenario(options: {
  connection: DevToolsConnection;
  scenario?: ScenarioName;
  /** Required by lease-conflict to create a real competing controller. */
  server?: DevToolsServer;
}) {
  const name = options.scenario ?? 'gain-plugin';
  if (!scenarioNames.includes(name))
    throw new Error('Unknown DevTools scenario');
  const runtimes: Awaited<ReturnType<typeof startSimulatedRuntime>>[] = [];
  let controller: Awaited<ReturnType<typeof startSimulatedBrowser>> | undefined;
  try {
    if (name !== 'empty') {
      runtimes.push(
        await startSimulatedRuntime({
          connection: options.connection,
          diagnostics: name !== 'limited-capabilities',
          sampleData: true,
        }),
      );
      if (name === 'multiple-targets')
        runtimes.push(
          await startSimulatedRuntime({
            connection: options.connection,
            name: 'Second Gain Plugin',
          }),
        );
      if (name === 'lease-conflict') {
        if (!options.server) throw new Error('lease-conflict requires server');
        controller = await startSimulatedBrowser(options.server);
        await controller.request('Control.acquire', runtimes[0]!.id);
      }
      if (name === 'reload') await runtimes[0]!.reload();
      if (name === 'disconnected') await runtimes[0]!.disconnect();
    }
  } catch (error) {
    await controller?.close();
    await Promise.all(runtimes.map((runtime) => runtime.close()));
    throw error;
  }
  return {
    runtimes,
    async close() {
      await controller?.close();
      await Promise.all(runtimes.map((runtime) => runtime.close()));
    },
  };
}

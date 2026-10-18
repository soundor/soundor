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
  'second-client',
] as const;
export type ScenarioName = (typeof scenarioNames)[number];

/** Clients are the real server's: second-client adds one beside the tab. */
export async function startScenario(options: {
  connection: DevToolsConnection;
  scenario?: ScenarioName;
  /** Required by second-client, whose client connects to the real server. */
  server?: DevToolsServer;
}) {
  const name = options.scenario ?? 'gain-plugin';
  if (!scenarioNames.includes(name))
    throw new Error('Unknown DevTools scenario');
  const runtimes: Awaited<ReturnType<typeof startSimulatedRuntime>>[] = [];
  let other: Awaited<ReturnType<typeof startSimulatedBrowser>> | undefined;
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
      if (name === 'second-client') {
        if (!options.server) throw new Error('second-client requires server');
        // Another client highlighting a node, as a script or a second tab.
        other = await startSimulatedBrowser(options.server);
        await other.request('UI.highlightNode', runtimes[0]!.id, {
          node: { generation: 1, id: '3' },
        });
      }
      if (name === 'reload') await runtimes[0]!.reload();
      if (name === 'disconnected') await runtimes[0]!.disconnect();
    }
  } catch (error) {
    await other?.close();
    await Promise.all(runtimes.map((runtime) => runtime.close()));
    throw error;
  }
  return {
    runtimes,
    async close() {
      await other?.close();
      await Promise.all(runtimes.map((runtime) => runtime.close()));
    },
  };
}

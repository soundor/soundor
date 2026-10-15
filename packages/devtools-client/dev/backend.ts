import { startDevToolsServer } from '@soundor/devtools-server';
import { startScenario, scenarioNames } from '@soundor/devtools-server/testing';
import type { Plugin } from 'vite';

/** Accept only credential-free loopback origins; never echo invalid secrets. */
export function parseBackendEndpoint(value: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('SOUNDOR_DEVTOOLS_BACKEND must be an HTTP loopback origin');
  }
  if (
    endpoint.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== '/' ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error(
      'SOUNDOR_DEVTOOLS_BACKEND must be a credential-free HTTP loopback origin',
    );
  return endpoint.origin;
}

/** Starts only after Vite binds, so even port 0 has one exact trusted origin. */
export function developmentBackend(
  options: {
    endpoint?: string | ((origin: string) => Promise<string>);
    scenario?: string;
  } = {},
): Plugin {
  let shutdown: (() => Promise<void>) | undefined;
  return {
    name: 'soundor-devtools-backend',
    async closeBundle() {
      await shutdown?.();
    },
    configureServer(vite) {
      const http = vite.httpServer;
      if (!http)
        throw new Error(
          'DevTools development requires a listening Vite server',
        );
      // Vite and its HTTP/WebSocket proxies retain this public URL target.
      // Updating its fields after bind avoids reserving/releasing a test port.
      const target = new URL(
        typeof options.endpoint === 'string'
          ? parseBackendEndpoint(options.endpoint)
          : 'http://127.0.0.1:0',
      );
      const proxy = (vite.config.server.proxy ??= {});
      for (const path of ['/browser', '/runtime']) {
        proxy[path] = { target, changeOrigin: true, ws: true };
      }
      let origin = '';
      let launchUrl: (() => string) | undefined;
      let ready: Promise<void> | undefined;
      let dispose: (() => Promise<void>) | undefined;
      let closing: Promise<void> | undefined;
      const start = () => {
        const address = http.address();
        if (!address || typeof address === 'string')
          throw new Error('Vite must bind a TCP port');
        origin = 'http://127.0.0.1:' + address.port;
        ready = (async () => {
          const external =
            typeof options.endpoint === 'function'
              ? await options.endpoint(origin)
              : options.endpoint;
          if (external !== undefined) {
            const endpoint = new URL(parseBackendEndpoint(external));
            target.hostname = endpoint.hostname;
            target.port = endpoint.port;
          } else {
            const scenarioName = scenarioNames.find(
              (name) => name === (options.scenario ?? 'gain-plugin'),
            );
            if (!scenarioName) throw new Error('Unknown DevTools scenario');
            const backend = await startDevToolsServer({
              projectRoot: process.cwd(),
              port: 0,
              developmentOrigin: origin,
            });
            let scenario;
            try {
              scenario = await startScenario({
                connection: backend.connection,
                server: backend,
                scenario: scenarioName,
              });
            } catch (error) {
              await backend.close();
              throw error;
            }
            target.port = new URL(backend.connection.endpoint).port;
            launchUrl = () => '/' + new URL(backend.browserLaunchUrl()).hash;
            dispose = () => scenario.close().finally(() => backend.close());
          }
          vite.config.logger.info(
            external !== undefined
              ? 'DevTools frontend ready at ' +
                  origin +
                  '/ (authorize with the existing session key)'
              : 'DevTools ready at ' + origin + '/__connect',
          );
        })();
        // Requests see the same failure through middleware. Handle it here too
        // if nobody opens a browser, without an unhandled rejected promise.
        void ready.catch((error: unknown) =>
          vite.config.logger.error(String(error)),
        );
      };
      http.once('listening', start);
      shutdown = () =>
        (closing ??= (async () => {
          http.off('listening', start);
          await ready?.catch(() => {});
          await dispose?.();
        })());
      http.once('close', () => {
        void shutdown?.().catch((error: unknown) =>
          vite.config.logger.error(String(error)),
        );
      });
      // Hold protocol traffic and bootstrap until the backend has registered
      // its scenario. Other Vite assets and HMR remain ordinary Vite traffic.
      vite.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0];
        if (
          path !== '/__connect' &&
          path !== '/browser' &&
          !path?.startsWith('/browser/') &&
          !path?.startsWith('/runtime/')
        )
          return next();
        void (async () => {
          await ready;
          if (!origin) {
            response.writeHead(503).end();
            return;
          }
          if (path === '/__connect') {
            response.writeHead(302, {
              Location: origin + (launchUrl?.() ?? '/'),
              'Cache-Control': 'no-store',
            });
            response.end();
          } else next();
        })().catch(next);
      });
    },
  };
}

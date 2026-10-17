/**
 * The editor's worker: TypeScript's language service, off the page's thread
 * (TypeScript is large, and checking takes a while). `TypeScriptClient`
 * talks to it.
 */

import ts from 'typescript-6';

import {
  createLanguageService,
  type ExampleLanguageService,
} from './language-service.ts';
import type { WorkerRequest, WorkerResponse } from './typescript.ts';

let service: ExampleLanguageService | undefined;

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const { id, method, args } = event.data;
  let response: WorkerResponse;
  try {
    if (method === 'init') {
      const [types, code] = args;
      service = createLanguageService(ts, types, code);
      response = { id, result: null };
    } else {
      if (service === undefined) throw new Error('The worker has no code yet');
      const call = service[method] as (...values: unknown[]) => unknown;
      response = { id, result: call(...args) };
    }
  } catch (error) {
    response = { id, error: String(error) };
  }
  self.postMessage(response);
});

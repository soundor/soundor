import { resolveConfig } from '@soundor/config';
import { describeState } from '@soundor/core';

import { historyConformance } from '../../core/test-data/history-conformance';
import { setParameterAsHost } from './parameters';
import { createTestRuntime } from './runtime';
historyConformance(() => {
  const config = resolveConfig({
    plugin: { id: 'test.history', name: 'History' },
    runtimes: [],
    parameters: {
      bypass: { type: 'boolean', label: 'Bypass', default: false },
    },
  });
  const runtime = createTestRuntime({
    parameters: config.parameters,
    state: describeState({ selected: { type: 'string?', default: null } }),
  });
  const bypass = runtime.parameters.byId.bypass!;
  return {
    history: runtime.history,
    bypass,
    selected: runtime.state.fields.selected!,
    host: (value) => setParameterAsHost(bypass, value as never),
  };
});

import { StateStore, describeState } from '@soundor/runtime-sdk/client';

import { historyConformance } from '../../../../packages/core/test-data/history-conformance';
import { publishParameter } from './parameters';
import { fixtureConfig } from './testing/fixture';
import { storeOf } from './testing/store';
historyConformance(() => {
  const parameters = storeOf(fixtureConfig.parameters);
  const state = new StateStore(
    describeState({ selected: { type: 'string?', default: null } }),
    parameters.history,
  );
  const bypass = parameters.byId.bypass!;
  return {
    history: parameters.history,
    bypass,
    selected: state.fields.selected!,
    host: (value) => publishParameter(bypass, value as never),
  };
});

# @soundor/vitest-e2e

End-to-end tests of a built VST3 plugin in Vitest. A test starts the plugin in
the real [VST3 host](https://soundor.dev/docs/testing/vst3-host) and checks its
UI and its audio together, with Vitest's own `test` and `expect`.

```ts
import { launchPlugin } from '@soundor/vitest-e2e';
import { expect, test } from 'vitest';

test('bypass lets the input through', async () => {
  const plugin = await launchPlugin();

  await plugin.getByRole('button', { name: 'Bypass' }).click();
  await expect(plugin.getByText('Bypassed')).toBeVisible();

  const input = new Float32Array(4800).fill(0.5);
  const { outputs } = await plugin.host.process({ inputs: [[input, input]] });
  expect(outputs[0]![0]).toEqual(input);
});
```

See the [guide](https://soundor.dev/docs/testing/e2e).

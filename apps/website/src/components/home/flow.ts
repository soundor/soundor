/**
 * The home page's walk through a project, from creating it to shipping it.
 * The code is the code a project really has (trimmed): `create-soundor-app`'s
 * template and the docs' examples. `marks` are the 1-based lines that carry
 * the `gain` parameter, which the page follows through every step.
 */

import { soundorVersion } from '@/lib/shared';

export interface CodeFile {
  readonly file: string;
  readonly lang: 'ts' | 'tsx' | 'rust' | 'sh';
  readonly code: string;
  readonly marks: readonly number[];
}

export const config: CodeFile = {
  file: 'soundor.config.ts',
  lang: 'ts',
  marks: [],
  code: `import { defineSoundorConfig } from '@soundor/config';
import { vst3Runtime } from '@soundor/vst3-runtime';
import { webRuntime } from '@soundor/web-runtime';

export default defineSoundorConfig({
  plugin: { id: 'com.example.plugin', name: 'My Plugin' },
  runtimes: [vst3Runtime(), webRuntime()],
  parameters: {
    gain: {
      type: 'float32',
      label: 'Gain',
      min: 0,
      max: 1,
      default: 0.5,
    },
  },
});`,
};

export const processor: CodeFile = {
  file: 'lib/src/processor.rs',
  lang: 'rust',
  marks: [],
  code: `use soundor::prelude::*;

#[derive(Default)]
pub struct PluginProcessor;

impl Processor for PluginProcessor {
    fn process(&mut self, ctx: &mut ProcessContext) {
        let gain = ctx.params.gain;
        for channel in ctx.audio.channels() {
            for sample in channel {
                *sample *= gain;
            }
        }
    }
}`,
};

export const ui: CodeFile = {
  file: 'src/App.tsx',
  lang: 'tsx',
  marks: [],
  code: `import { Pressable, Text, View } from '@soundor/react';
import { useParameter } from '@soundor/react';
import { parameters } from 'soundor:parameters';

export function App() {
  const gain = useParameter(parameters.gain);

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text>Gain {gain.toFixed(2)}</Text>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: '#2a2a2e' }}>
        <View
          style={{
            width: \`\${gain * 100}%\`,
            height: 8,
            borderRadius: 4,
            backgroundColor: '#7c5cff',
          }}
        />
      </View>
      <Pressable onPress={() => parameters.gain.set(0.5)}>
        <Text>Reset gain</Text>
      </Pressable>
    </View>
  );
}`,
};

export const test: CodeFile = {
  file: 'src/App.test.tsx',
  lang: 'tsx',
  marks: [],
  code: `import {
  render, screen, testParameters, userEvent,
} from '@soundor/testing-library/react';
import { parameters } from 'soundor:parameters';
import { expect, test } from 'vitest';
import { App } from './App';

test('resets the gain', async () => {
  const user = userEvent.setup();
  testParameters.set('gain', 0.75);
  await render(<App />);

  const reset = screen.getByRole('button', {
    name: 'Reset gain',
  });
  await user.click(reset);
  expect(parameters.gain.get()).toBe(0.5);
});`,
};

export const e2e: CodeFile = {
  file: 'e2e/plugin.test.ts',
  lang: 'ts',
  marks: [],
  code: `import { launchPlugin } from '@soundor/vitest-e2e';
import { expect, test } from 'vitest';

test('reset brings the sound back to half', async () => {
  const plugin = await launchPlugin({
    plugin: '.soundor/debug/vst3/My Plugin.vst3',
  });
  await plugin
    .getByRole('button', { name: 'Reset gain' })
    .click();
  const shown = plugin.getByText('Gain 0.50');
  await expect(shown).toBeVisible();

  const input = new Float32Array(4800).fill(1);
  const { outputs } = await plugin.host.process({
    inputs: [[input, input]],
  });
  expect(outputs[0]![0]![100]).toBeCloseTo(0.5);
});`,
};

/** A terminal command, highlighted as the docs' `sh` blocks are. */
const command = (code: string): CodeFile => ({
  file: 'Terminal',
  lang: 'sh',
  marks: [],
  code,
});

export const files = {
  create: command(`npm create soundor-app@${soundorVersion} my-plugin`),
  config,
  processor,
  ui,
  dev: command('npm run dev'),
  test,
  testRun: command('npm test'),
  e2e,
  build: command('npm run build'),
} as const;
export type FileId = keyof typeof files;

// The processor (the plugin's Rust, on the host's audio thread) in the VST3
// host without an editor: what comes out for what goes in, with parameters
// the host sets, as one block or several, at the host's sample rate.
import { launchHost, noise, render } from '@soundor/vitest-e2e';
import { expect, test } from 'vitest';

type Host = Awaited<ReturnType<typeof launchHost>>;

const input = noise({ seconds: 0.25, amplitude: 0.5, seed: 1 });
const scaled = (factor: number) => input.map((sample) => sample * factor);

async function play(host: Host) {
  const { outputs } = await host.process({ inputs: [[input, input]] });
  return outputs[0]!;
}

test('at the defaults the output is the input', async () => {
  const host = await launchHost();

  const [left, right] = await play(host);

  expect(left).toBeCloseToAudio(input);
  expect(right).toBeCloseToAudio(input);
});

test('Gain scales the output', async () => {
  const host = await launchHost();
  // 0 to 2: a quarter of the way is 0.5.
  await host.parameter('Gain').set(0.25);

  const [left] = await play(host);

  expect(left).toBeCloseToAudio(scaled(0.5));
});

test('Invert mode turns the output upside down', async () => {
  const host = await launchHost();
  await host.parameter('Mode').set(1);

  const [left] = await play(host);

  expect(left).toBeCloseToAudio(scaled(-1));
});

test('Bypass lets the input through whatever the other parameters', async () => {
  const host = await launchHost();
  await host.parameter('Gain').set(0);
  await host.parameter('Bypass').set(1);

  const [left] = await play(host);

  expect(left).toBeCloseToAudio(input);
});

// Parameters reach the processor once per block (docs: rust-processor), at
// the last value the block's changes give them.
test('a change inside a block applies to the whole block', async () => {
  const host = await launchHost();
  const { id } = await host.parameter('Gain').get();

  const { outputs } = await host.process({
    inputs: [[input, input]],
    parameterChanges: [{ id, value: 0, time: 256 }],
  });

  expect(outputs[0]![0]!).toBeSilent();
  // And it holds for the blocks after.
  expect((await play(host))[0]).toBeSilent();
});

test('the output does not depend on the size of the blocks', async () => {
  const played = async (blockSize: number | number[]) => {
    const host = await launchHost();
    await host.parameter('Gain').set(0.3);
    const { outputs } = await render(host, {
      inputs: [[input, input]],
      blockSize,
    });
    return outputs[0]!;
  };

  expect(await played([37, 512, 64, 1])).toBeCloseToAudio(await played(512));
});

test('it plays at another sample rate', async () => {
  const host = await launchHost({ sampleRate: 44_100 });
  await host.parameter('Gain').set(0.25);

  const [left] = await play(host);

  expect(left).toBeCloseToAudio(scaled(0.5));
});

test('a saved state restores what the processor plays', async () => {
  const first = await launchHost();
  await first.parameter('Gain').set(0.25);
  await first.parameter('Mode').set(1);
  await first.process({ frames: 512 });
  const state = await first.getState();

  const second = await launchHost();
  await second.setState(state);

  const [left] = await play(second);
  expect(left).toBeCloseToAudio(scaled(-0.5));
});

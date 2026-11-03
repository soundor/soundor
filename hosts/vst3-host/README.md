# @soundor/vst3-host

A standalone VST3 host for tests and development: a native executable driven
from Node.js. It loads a `.vst3` bundle by path, processes audio offline
(parameters, MIDI, transport, state), and opens the plugin's editor in a
native window when asked. Any VST3 plugin, made with Soundor or not.

```sh
pnpm add -D @soundor/vst3-host
```

```ts
import { launchHost } from '@soundor/vst3-host';

const host = await launchHost({
  plugin: 'build/MyPlugin.vst3',
  sampleRate: 48_000,
  blockSize: 512,
});
try {
  const [first] = await host.getParameters();
  await host.setParameter(first!.id, 0.5);
  const input = new Float32Array(48_000);
  const { outputs } = await host.process({ inputs: [[input, input]] });
} finally {
  await host.close();
}
```

The executable comes in a platform package installed with this one, at the
same version: Linux x64 (glibc), macOS (arm64 and x64) and Windows x64.
Installing compiles and downloads nothing else.

Documentation: [user guide](https://soundor.dev/docs/testing/vst3-host) and
[internals](https://soundor.dev/docs/contribute/vst3-host) (building from
source, prebuilt selection, releases).

## License

MIT (LICENSE). The executable includes the VST3 SDK, under its own MIT license
(NOTICE.md). VST is a registered trademark of Steinberg Media Technologies GmbH.

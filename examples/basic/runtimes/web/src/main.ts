// The Web host's entry: starts Soundor's Web host for this plugin. Its audio
// is native/ compiled to WebAssembly, the processor the JUCE plugin runs. The
// plugin's native API loads after the host, so its soundor:* imports find it
// ready.
import { startSoundorWebHost } from '@soundor/web-runtime/client';

await startSoundorWebHost({});

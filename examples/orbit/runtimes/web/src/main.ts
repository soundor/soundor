// The Web host's entry: starts Soundor's Web host for this plugin, whose
// audio is native/ compiled to WebAssembly, the same delay the JUCE plugin
// runs. The demo input is a loop that shows the echoes off.
import { startSoundorWebHost } from '@soundor/web-runtime/client';

import { demoInput } from './demo';

await startSoundorWebHost({
  audioInputs: [demoInput],
  defaultAudioInput: demoInput.id,
});

import { startSoundorWebHost } from '@soundor/web-runtime/client';

import { demoInput } from './demo';

await startSoundorWebHost({
  native: () => import('./native'),
  audio: () => import('./audio'),
  audioInputs: [demoInput],
  defaultAudioInput: demoInput.id,
});

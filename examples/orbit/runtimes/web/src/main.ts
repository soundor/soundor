import { startSoundorWebHost } from '@soundor/web-runtime/client';

import { setDemoEnabled } from './demo';

await startSoundorWebHost({
  native: () => import('./native'),
  audio: () => import('./audio'),
});

const source = document.querySelector<HTMLSelectElement>('#audio-source')!;
source.addEventListener('change', () =>
  setDemoEnabled(source.value === 'demo'),
);

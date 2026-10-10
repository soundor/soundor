// The Web host's entry: starts Soundor's Web host for this plugin. The
// plugin's native API and audio load after the host, so their soundor:*
// imports find it ready.
import { startSoundorWebHost } from '@soundor/web-runtime/client';

await startSoundorWebHost({
  native: () => import('./native'),
  audio: () => import('./audio'),
});

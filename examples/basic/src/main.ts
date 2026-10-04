// The plugin's UI entry: bundled by `soundor dev` / `soundor build` and run by
// Soundor's embedded JavaScript runtime inside the plugin view. Rendering
// arrives with the Soundor UI; for now the UI talks to the plugin and logs.

import { plugin } from 'soundor:host';
import { parameters } from 'soundor:parameters';

console.info(
  `${plugin.name} UI started — gain ${parameters.gain.get().toFixed(2)}`,
);

parameters.gain.subscribe((gain) => {
  console.info(`gain → ${gain.toFixed(2)}`);
});

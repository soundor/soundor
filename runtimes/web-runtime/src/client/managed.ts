import inputs from 'soundor:internal/inputs';

import { startSoundorWebHost } from './index';
import { validateInputs } from './input';

try {
  await startSoundorWebHost({ inputs: validateInputs(inputs) });
} catch (error) {
  const message = document.createElement('pre');
  message.textContent = `The Soundor Web host could not start: ${error instanceof Error ? error.message : String(error)}`;
  (document.getElementById('soundor') ?? document.body).replaceChildren(
    message,
  );
  throw error;
}

import { expect } from 'vitest';

import { audioMatchers } from './audio-matchers';
import { e2eMatchers } from './matchers';

expect.extend(e2eMatchers);
expect.extend(audioMatchers);

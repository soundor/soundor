// What both test plugins share: their parameters and UI (src/ui.ts). Each one's
// soundor.config.ts names it and says where its engine comes from.
import type { Parameter } from '@soundor/config';

export const parameters = [
  {
    type: 'float',
    id: 'gain',
    label: 'Gain',
    min: 0,
    max: 1,
    default: 0.5,
    unit: 'dB',
  },
  { type: 'bool', id: 'bypass', label: 'Bypass', default: false },
] satisfies Parameter[];

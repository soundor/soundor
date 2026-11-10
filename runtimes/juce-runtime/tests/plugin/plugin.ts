// What both test plugins share: their parameters and UI (src/ui.ts). Each one's
// soundor.config.ts names it and says where its engine comes from.
import type { ParameterDeclarations } from '@soundor/config';

export const parameters = {
  gain: {
    type: 'float32',
    label: 'Gain',
    min: 0,
    max: 1,
    default: 0.5,
    unit: 'dB',
  },
  bypass: { type: 'boolean', label: 'Bypass', default: false },
} as const satisfies ParameterDeclarations;

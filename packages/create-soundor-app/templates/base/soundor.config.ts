import { defineSoundorConfig } from '@soundor/config';
__RUNTIME_IMPORTS__;

export default defineSoundorConfig({
  plugin: {
    // A stable, globally unique reverse-DNS id. Never change it after release:
    // hosts and saved sessions identify the plugin by it.
    id: 'com.example.__PROJECT_ID__',
    name: '__PROJECT_NAME__',
  },
  runtimes: __RUNTIMES__,
  parameters: [
    {
      type: 'float',
      id: 'gain',
      label: 'Gain',
      min: 0,
      max: 1,
      default: 0.5,
      unit: 'dB',
    },
  ],
});

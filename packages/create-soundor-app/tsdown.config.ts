import { node, withPreset } from '@soundor/tsdown-config';
import { defineConfig } from 'tsdown';

import { templateVersions } from './template-versions.ts';

export default defineConfig(
  withPreset(node, {
    entry: ['src/index.ts'],
    tsconfig: './tsconfig.app.json',
    dts: false,
    banner: { js: '#!/usr/bin/env node' },
    define: { __TEMPLATE_VERSIONS__: JSON.stringify(templateVersions()) },
  }),
);

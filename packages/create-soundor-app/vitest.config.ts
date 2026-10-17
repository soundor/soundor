import { defineConfig } from 'vitest/config';

import { templateVersions } from './template-versions.ts';

export default defineConfig({
  define: { __TEMPLATE_VERSIONS__: JSON.stringify(templateVersions()) },
  test: {
    include: ['src/**/*.test.ts'],
  },
});

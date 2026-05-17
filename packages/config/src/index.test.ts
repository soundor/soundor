import { describe, expect, it } from 'vitest';

import { parseConfig } from './index';
import type { Parameter, ProjectConfig } from './index';

describe('parseConfig', () => {
  it('resolves to a ProjectConfig', async () => {
    const config = await parseConfig('soundor.config.ts');
    expect(config).toMatchObject<Partial<ProjectConfig>>({
      name: expect.any(String),
      runtime: expect.any(String),
      parameters: expect.any(Array),
    });
  });
});

describe('types', () => {
  it('Parameter shape is correct', () => {
    const param: Parameter = { id: 'gain', label: 'Gain' };
    expect(param.id).toBe('gain');
    expect(param.label).toBe('Gain');
  });

  it('ProjectConfig shape is correct', () => {
    const config: ProjectConfig = {
      name: 'my-plugin',
      runtime: 'juce',
      parameters: [{ id: 'gain', label: 'Gain' }],
    };
    expect(config.name).toBe('my-plugin');
    expect(config.parameters).toHaveLength(1);
  });
});

import type { ProjectConfig } from './types';

export async function parseConfig(_path: string): Promise<ProjectConfig> {
  return {
    name: 'soundor-project',
    runtime: 'juce',
    parameters: [],
  };
}

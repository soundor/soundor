import type { ProjectConfig } from '@soundor/config';

export type { ProjectConfig };

export interface BuildOptions {
  mode: 'debug' | 'production';
}

export interface Runtime {
  dev(config: ProjectConfig): Promise<void>;
  build(config: ProjectConfig, options: BuildOptions): Promise<void>;
}

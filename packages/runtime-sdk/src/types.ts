import type { SoundorConfig } from '@soundor/config';

export type { SoundorConfig };

export interface BuildOptions {
  mode: 'debug' | 'production';
}

export interface Runtime {
  dev(config: SoundorConfig): Promise<void>;
  build(config: SoundorConfig, options: BuildOptions): Promise<void>;
}

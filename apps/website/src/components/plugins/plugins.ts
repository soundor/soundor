/** A plugin made and maintained by the Soundor project. */
export interface OfficialPlugin {
  readonly name: string;
  readonly kind: string;
  readonly description: string;
  /** The plugin formats and runtimes it is built for. */
  readonly formats: readonly string[];
  /** Its own site. */
  readonly url: string;
}

/** The official plugins, in the order the page lists them. */
export const officialPlugins: readonly OfficialPlugin[] = [
  {
    name: 'Orbit',
    kind: 'Stereo delay',
    description:
      'A three-voice stereo delay with a WebGL echo map. Drag each echo to set its timing and level, shape feedback, tone, motion and stereo spread, and hold the echoes as repeating loops.',
    formats: ['VST3', 'Web'],
    url: 'https://orbit.soundor.dev/',
  },
];

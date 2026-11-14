import {
  initialBusLayout,
  type AudioChannelLayout,
  type ResolvedSoundorConfig,
} from '@soundor/runtime-sdk';
import { cppStringLiteral } from '@soundor/runtime-sdk/expression/cpp';

const sets: Record<AudioChannelLayout, string> = {
  disabled: 'disabled',
  mono: 'mono',
  stereo: 'stereo',
  '5.1': 'create5point1',
  '7.1': 'create7point1',
};
const set = (layout: AudioChannelLayout) =>
  `juce::AudioChannelSet::${sets[layout]}()`;

export function audioDeclaration(config: ResolvedSoundorConfig): string {
  const audio = config.audio;
  if (!audio) return '';
  const tail = audio.tail;
  const bypass = config.parameters.find((p) => p.role === 'bypass');
  return `
        static BusesProperties configuredBuses();
        bool isBusesLayoutSupported(const BusesLayout&) const override final;
        double getTailLengthSeconds() const override final { return tailSeconds.load(std::memory_order_relaxed); }
        ${tail?.mode === 'dynamic' ? '// Control thread. Validate before publishing to host-facing readers.\n        void setTailLengthSeconds(double seconds);' : ''}
        ${bypass ? `juce::AudioProcessorParameter* getBypassParameter() const override { return parameters->getParameter(${cppStringLiteral(bypass.id)}); }` : ''}
`.replace(/[ \t]+$/gm, '');
}

export function audioImplementation(config: ResolvedSoundorConfig): string {
  const audio = config.audio;
  if (!audio) return '';
  const buses = Object.entries(audio.buses);
  const indexes = { input: 0, output: 0 };
  const indexed = buses.map(([id, bus]) => ({
    id,
    ...bus,
    index: indexes[bus.direction]++,
  }));
  const properties = buses
    .map(([id, bus]) => {
      const layout = initialBusLayout(audio, id);
      // Disabled buses still need their speaker arrangement when enabled by a host.
      const enabledLayout =
        layout === 'disabled'
          ? (Object.values(audio.layouts)
              .flatMap((value) => value[id] ?? [])
              .find((value) => value !== 'disabled') ?? 'stereo')
          : layout;
      return `.with${bus.direction === 'input' ? 'Input' : 'Output'}(${cppStringLiteral(bus.name)}, ${set(enabledLayout)}, ${layout !== 'disabled'})`;
    })
    .join('\n            ');
  const alternatives = Object.values(audio.layouts)
    .map((layout) =>
      indexed
        .map((bus) => {
          const value = layout[bus.id]!;
          const choices = typeof value === 'string' ? [value] : value;
          return `(${choices.map((v) => `layouts.getChannelSet(${bus.direction === 'input'}, ${bus.index}) == ${set(v)}`).join(' || ')})`;
        })
        .join(' && '),
    )
    .map((value) => `(${value})`)
    .join('\n            || ');
  return `
    juce::AudioProcessor::BusesProperties AudioProcessor::configuredBuses()
    {
        return BusesProperties()${properties};
    }
    bool AudioProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const
    {
        if (layouts.inputBuses.size() != ${indexes.input} || layouts.outputBuses.size() != ${indexes.output}) return false;
        return ${alternatives};
    }
    ${
      audio.tail?.mode === 'dynamic'
        ? `void AudioProcessor::setTailLengthSeconds(double seconds)
    {
        if (!std::isfinite(seconds) || seconds < 0) throw std::invalid_argument("tail seconds must be finite and nonnegative");
        tailSeconds.store(seconds, std::memory_order_relaxed);
    }`
        : ''
    }
`;
}

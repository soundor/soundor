#include <soundor/soundor.h>

namespace
{
    class PluginProcessor final : public soundor::AudioProcessor
    {
    public:
#if SOUNDOR_CONFIGURED_AUDIO
        PluginProcessor() = default;
#else
        PluginProcessor()
            : soundor::AudioProcessor(BusesProperties()
                                          .withInput("Input", juce::AudioChannelSet::stereo(), true)
                                          .withOutput("Output", juce::AudioChannelSet::stereo(), true))
        {
        }

        bool isBusesLayoutSupported(const BusesLayout& layouts) const override
        {
            const auto& output = layouts.getMainOutputChannelSet();
            return (output == juce::AudioChannelSet::mono() || output == juce::AudioChannelSet::stereo())
                   && output == layouts.getMainInputChannelSet();
        }

        double getTailLengthSeconds() const override { return 0.0; }
#endif
        juce::AudioProcessorEditor* createEditor() override { return new soundor::AudioProcessorEditor(*this); }
        bool hasEditor() const override { return true; }
        const juce::String getName() const override { return pluginName; }
        bool acceptsMidi() const override { return JucePlugin_WantsMidiInput != 0; }
        bool producesMidi() const override { return JucePlugin_ProducesMidiOutput != 0; }
        bool isMidiEffect() const override { return JucePlugin_IsMidiEffect != 0; }

#if ! SOUNDOR_FACTORY_PRESETS
        int getNumPrograms() override { return 1; }
        int getCurrentProgram() override { return 0; }
        void setCurrentProgram(int) override {}
        const juce::String getProgramName(int) override { return {}; }
        void changeProgramName(int, const juce::String&) override {}
#endif
    };
} // namespace

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new PluginProcessor();
}

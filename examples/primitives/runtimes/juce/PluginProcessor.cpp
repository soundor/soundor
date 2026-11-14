#include "PluginProcessor.h"

#include "PluginEditor.h"

SoundorPrimitivesProcessor::SoundorPrimitivesProcessor()
    : soundor::AudioProcessor(BusesProperties()
                                  .withInput("Input", juce::AudioChannelSet::stereo(), true)
                                  .withOutput("Output", juce::AudioChannelSet::stereo(), true))
{
}

bool SoundorPrimitivesProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const
{
    // Standalone always runs stereo, but a DAW (e.g. Reaper) negotiates the bus
    // layout and, without this guard, JUCE would accept any arrangement — then
    // the processing could be handed a layout it doesn't handle (discrete,
    // in != out). Restrict to mono or stereo with the input matching the output.
    // Declare `audio` in soundor.config to have Soundor generate this.
    const auto& mainOutput = layouts.getMainOutputChannelSet();
    const auto& mainInput = layouts.getMainInputChannelSet();

    if (mainOutput != juce::AudioChannelSet::mono() && mainOutput != juce::AudioChannelSet::stereo())
        return false;

    return mainInput == mainOutput;
}

juce::AudioProcessorEditor* SoundorPrimitivesProcessor::createEditor()
{
    return new SoundorPrimitivesEditor(*this);
}

// Plugin entry point.
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new SoundorPrimitivesProcessor();
}

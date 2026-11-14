#include "PluginProcessor.h"

#include "PluginEditor.h"

SoundorAnalyzerProcessor::SoundorAnalyzerProcessor()
    : soundor::AudioProcessor(BusesProperties()
                                  .withInput("Input", juce::AudioChannelSet::stereo(), true)
                                  .withOutput("Output", juce::AudioChannelSet::stereo(), true))
{
}

bool SoundorAnalyzerProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const
{
    const auto& mainOutput = layouts.getMainOutputChannelSet();
    if (mainOutput != juce::AudioChannelSet::mono() && mainOutput != juce::AudioChannelSet::stereo())
        return false;
    return layouts.getMainInputChannelSet() == mainOutput;
}

juce::AudioProcessorEditor* SoundorAnalyzerProcessor::createEditor()
{
    return new SoundorAnalyzerEditor(*this);
}

// Plugin entry point.
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new SoundorAnalyzerProcessor();
}

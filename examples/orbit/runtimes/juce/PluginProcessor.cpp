#include "PluginProcessor.h"

#include "PluginEditor.h"

OrbitProcessor::OrbitProcessor()
    : soundor::AudioProcessor(BusesProperties()
                                  .withInput("Input", juce::AudioChannelSet::stereo(), true)
                                  .withOutput("Output", juce::AudioChannelSet::stereo(), true))
{
}

bool OrbitProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const
{
    const auto output = layouts.getMainOutputChannelSet();
    return (output == juce::AudioChannelSet::mono() || output == juce::AudioChannelSet::stereo())
           && output == layouts.getMainInputChannelSet();
}

juce::AudioProcessorEditor* OrbitProcessor::createEditor()
{
    return new OrbitEditor(*this);
}
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new OrbitProcessor();
}

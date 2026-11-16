#include "PluginProcessor.h"

#include "PluginEditor.h"

SoundorControllerProcessor::SoundorControllerProcessor() : soundor::AudioProcessor() {}

juce::AudioProcessorEditor* SoundorControllerProcessor::createEditor()
{
    return new SoundorControllerEditor(*this);
}

// Plugin entry point.
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new SoundorControllerProcessor();
}

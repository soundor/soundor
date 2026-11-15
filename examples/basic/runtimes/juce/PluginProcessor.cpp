#include "PluginProcessor.h"

#include "PluginEditor.h"

SoundorBasicProcessor::SoundorBasicProcessor() : soundor::AudioProcessor() {}

juce::AudioProcessorEditor* SoundorBasicProcessor::createEditor()
{
    return new SoundorBasicEditor(*this);
}

// Plugin entry point.
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new SoundorBasicProcessor();
}

#include "PluginProcessor.h"

#include "PluginEditor.h"

SoundorBasicProcessor::SoundorBasicProcessor() : soundor::AudioProcessor() {}

void SoundorBasicProcessor::prepareToPlay(double sampleRate, int samplesPerBlock)
{
    juce::ignoreUnused(sampleRate, samplesPerBlock);

    // Start the ramp from the current parameter value so the first block after
    // (re)prepare doesn't glide up from silence.
    previousGain = gainParameter.load();
}

void SoundorBasicProcessor::process(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    // Apply the "gain" parameter as a linear output gain. gainParameter is
    // provided by the soundor::AudioProcessor base (generated from the config's
    // `gain` parameter). Ramp from the previous block's value to the current
    // one so automation moves don't produce zipper noise.
    const float targetGain = gainParameter.load();
    buffer.applyGainRamp(0, buffer.getNumSamples(), previousGain, targetGain);
    previousGain = targetGain;
}

juce::AudioProcessorEditor* SoundorBasicProcessor::createEditor()
{
    return new SoundorBasicEditor(*this);
}

// Plugin entry point.
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new SoundorBasicProcessor();
}

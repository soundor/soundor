#include "PluginProcessor.h"
#include "PluginEditor.h"

#include <cmath>

SoundorBasicProcessor::SoundorBasicProcessor()
    : soundor::AudioProcessor(BusesProperties()
        .withInput("Input", juce::AudioChannelSet::stereo(), true)
        .withOutput("Output", juce::AudioChannelSet::stereo(), true))
{
}

void SoundorBasicProcessor::prepareToPlay(double sampleRate, int samplesPerBlock)
{
    juce::ignoreUnused(sampleRate, samplesPerBlock);
}

void SoundorBasicProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    // TODO: your DSP here. Read parameters via the generated pointers on the
    // soundor::AudioProcessor base (e.g. gainParameter->load()).

    // App-specific telemetry: output RMS, stashed for the editor to stream.
    float sumSquares = 0.0f;
    int count = 0;
    for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
    {
        const auto* data = buffer.getReadPointer(ch);
        for (int i = 0; i < buffer.getNumSamples(); ++i)
        {
            sumSquares += data[i] * data[i];
            ++count;
        }
    }
    currentLevel.store(count > 0 ? std::sqrt(sumSquares / static_cast<float>(count)) : 0.0f);
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

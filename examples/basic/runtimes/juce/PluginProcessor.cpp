#include "PluginProcessor.h"
#include "PluginEditor.h"

SoundorBasicProcessor::SoundorBasicProcessor()
    : soundor::AudioProcessor(BusesProperties()
        .withInput("Input", juce::AudioChannelSet::stereo(), true)
        .withOutput("Output", juce::AudioChannelSet::stereo(), true))
{
}

void SoundorBasicProcessor::prepareToPlay(double sampleRate, int samplesPerBlock)
{
    juce::ignoreUnused(sampleRate, samplesPerBlock);

    // Start the ramp from the current parameter value so the first block after
    // (re)prepare doesn't glide up from silence.
    previousGain = gainParameter->load();
}

bool SoundorBasicProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const
{
    // Standalone always runs stereo, but a DAW (e.g. Reaper) negotiates the bus
    // layout and, without this guard, JUCE would accept any arrangement — then
    // processBlock could be handed a layout we don't handle (mono, discrete,
    // in != out). Restrict to mono or stereo with the input matching the output.
    const auto& mainOutput = layouts.getMainOutputChannelSet();
    const auto& mainInput = layouts.getMainInputChannelSet();

    if (mainOutput != juce::AudioChannelSet::mono()
        && mainOutput != juce::AudioChannelSet::stereo())
        return false;

    return mainInput == mainOutput;
}

void SoundorBasicProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    // Apply the "gain" parameter as a linear output gain. gainParameter is
    // provided by the soundor::AudioProcessor base (generated from the config's
    // `gain` parameter). Ramp from the previous block's value to the current
    // one so automation moves don't produce zipper noise.
    const float targetGain = gainParameter->load();
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

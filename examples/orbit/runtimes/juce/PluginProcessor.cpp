#include "PluginProcessor.h"

#include "PluginEditor.h"

OrbitProcessor::OrbitProcessor()
    : soundor::AudioProcessor(BusesProperties()
                                  .withInput("Input", juce::AudioChannelSet::stereo(), true)
                                  .withOutput("Output", juce::AudioChannelSet::stereo(), true))
{
}

void OrbitProcessor::prepareToPlay(double sampleRate, int)
{
    delay.prepare(sampleRate);
}

bool OrbitProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const
{
    const auto output = layouts.getMainOutputChannelSet();
    return (output == juce::AudioChannelSet::mono() || output == juce::AudioChannelSet::stereo())
           && output == layouts.getMainInputChannelSet();
}

void OrbitProcessor::process(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;
    double bpm = 120;
    if (const auto* playhead = getPlayHead())
        if (const auto position = playhead->getPosition())
            if (const auto tempo = position->getBpm())
                bpm = std::clamp(*tempo, 20.0, 400.0);
    const auto beat = syncParameter->load() >= 0.5f ? 60.0 / bpm : 0.5;
    orbit::Settings settings;
    settings.times = { static_cast<float>(time1Parameter->load() * beat),
                       static_cast<float>(time2Parameter->load() * beat),
                       static_cast<float>(time3Parameter->load() * beat) };
    settings.levels = { level1Parameter->load(), level2Parameter->load(), level3Parameter->load() };
    settings.feedback = feedbackParameter->load();
    settings.tone = toneParameter->load();
    settings.motion = motionParameter->load();
    settings.spread = spreadParameter->load();
    settings.mix = mixParameter->load();
    settings.hold = holdParameter->load() >= 0.5f;
    settings.bypass = bypassParameter->load() >= 0.5f;
    delay.configure(settings);
    const bool stereo = buffer.getNumChannels() > 1;
    auto* left = buffer.getWritePointer(0);
    auto* right = stereo ? buffer.getWritePointer(1) : left;
    for (int i = 0; i < buffer.getNumSamples(); ++i)
    {
        const auto result = delay.tick(left[i], right[i], settings);
        left[i] = stereo ? result[0] : (result[0] + result[1]) * 0.5f;
        if (stereo)
            right[i] = result[1];
    }
}

juce::AudioProcessorEditor* OrbitProcessor::createEditor()
{
    return new OrbitEditor(*this);
}
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new OrbitProcessor();
}

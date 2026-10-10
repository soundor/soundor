#pragma once

#include "PluginProcessor.h"

#include <soundor/soundor.h>

// Your plugin's editor. Inherits soundor::AudioProcessorEditor, the view the
// Soundor UI renders into.
class SoundorBenchmarkEditor final : public soundor::AudioProcessorEditor
{
public:
    explicit SoundorBenchmarkEditor(SoundorBenchmarkProcessor&);
    ~SoundorBenchmarkEditor() override = default;

private:
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(SoundorBenchmarkEditor)
};

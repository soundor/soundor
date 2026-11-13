#pragma once

#include "PluginProcessor.h"

#include <soundor/soundor.h>

// Your plugin's editor. Inherits soundor::AudioProcessorEditor, the view the
// Soundor UI renders into.
class SoundorAnalyzerEditor final : public soundor::AudioProcessorEditor
{
public:
    explicit SoundorAnalyzerEditor(SoundorAnalyzerProcessor&);
    ~SoundorAnalyzerEditor() override = default;

private:
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(SoundorAnalyzerEditor)
};

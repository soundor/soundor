#pragma once

#include <soundor/soundor.h>

#include "PluginProcessor.h"

// Your plugin's editor. Inherits soundor::AudioProcessorEditor, the view the
// Soundor UI renders into.
class SoundorBasicEditor final : public soundor::AudioProcessorEditor
{
public:
    explicit SoundorBasicEditor(SoundorBasicProcessor&);
    ~SoundorBasicEditor() override = default;

private:
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(SoundorBasicEditor)
};

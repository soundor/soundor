#pragma once

#include <soundor/soundor.h>

#include "PluginProcessor.h"

// Your plugin's editor. Inherits soundor::AudioProcessorEditor (WebView +
// parameter bridge). Override onFrame() to stream app-specific telemetry.
class SoundorBasicEditor final : public soundor::AudioProcessorEditor
{
public:
    explicit SoundorBasicEditor(SoundorBasicProcessor&);
    ~SoundorBasicEditor() override = default;

protected:
    void onFrame() override;

private:
    SoundorBasicProcessor& processor;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(SoundorBasicEditor)
};

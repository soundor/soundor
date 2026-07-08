#include "PluginEditor.h"

SoundorBasicEditor::SoundorBasicEditor(SoundorBasicProcessor& p)
    : soundor::AudioProcessorEditor(p), processor(p)
{
}

void SoundorBasicEditor::onFrame()
{
    // Push the audio level to the UI as a 'level' event (~60fps). Subscribe on
    // the UI with useEvent('level', ...) / useEventValue('level').
    emitEvent("level", juce::var(processor.getCurrentLevel()));
}

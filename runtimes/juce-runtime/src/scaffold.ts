/**
 * Project scaffolding for the JUCE runtime's `init` phase — the **user-owned**
 * host, written once under `runtimes/<id>/` and never regenerated. The user has
 * full control here, including `CMakeLists.txt`; Soundor injects only a single
 * `include(...)` line pointing at the generated `setup.cmake`.
 *
 * The scaffolded classes inherit the generated `soundor::AudioProcessor` /
 * `soundor::AudioProcessorEditor` bases (which own parameters + the WebView
 * bridge). App-specific behavior that is *not* derived from config — here, audio
 * -level metering streamed to the UI — lives in these files, not in `gen`.
 */

import type { ResolvedJuceOptions } from './options';

/** A file to scaffold, path relative to the project root. */
export interface ScaffoldFile {
  readonly path: string;
  readonly contents: string;
}

/**
 * The files scaffolded on `init`, under `runtimes/<runtimeId>/`. `includePath`
 * is the project-relative path from that dir to the generated `setup.cmake`.
 */
export function juceScaffoldFiles(
  options: ResolvedJuceOptions,
  runtimeId: string,
  includePath: string,
): ScaffoldFile[] {
  const dir = `runtimes/${runtimeId}`;
  const cls = cppClassBase(options.pluginName);
  return [
    {
      path: `${dir}/CMakeLists.txt`,
      contents: cmakeLists(options, includePath),
    },
    {
      path: `${dir}/PluginProcessor.h`,
      contents: processorHeader(cls, options.pluginName),
    },
    { path: `${dir}/PluginProcessor.cpp`, contents: processorSource(cls) },
    { path: `${dir}/PluginEditor.h`, contents: editorHeader(cls) },
    { path: `${dir}/PluginEditor.cpp`, contents: editorSource(cls) },
  ];
}

function cmakeLists(options: ResolvedJuceOptions, includePath: string): string {
  return `cmake_minimum_required(VERSION 3.22)

project(${cmakeProject(options.pluginName)})

# Soundor injects only the generated JUCE setup below (parameters, plugin
# formats, the WebView bridge). Everything else in this file is yours to edit.
include(\${CMAKE_CURRENT_SOURCE_DIR}/${includePath})

target_sources(\${PROJECT_NAME}
    PRIVATE
        PluginEditor.cpp
        PluginProcessor.cpp)
`;
}

function processorHeader(cls: string, pluginName: string): string {
  return `#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <soundor/soundor.h>

#include <atomic>

// Your plugin's processor. Inherits soundor::AudioProcessor, which owns the
// parameter tree generated from soundor.config. Add your DSP here.
class ${cls}Processor final : public soundor::AudioProcessor
{
public:
    ${cls}Processor();
    ~${cls}Processor() override = default;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return ${JSON.stringify(pluginName)}; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    // App-specific UI telemetry (not part of the generated framework): the
    // latest output RMS level, pushed to the UI by the editor's onFrame().
    float getCurrentLevel() const { return currentLevel.load(); }

private:
    std::atomic<float> currentLevel { 0.0f };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(${cls}Processor)
};
`;
}

function processorSource(cls: string): string {
  return `#include "PluginProcessor.h"
#include "PluginEditor.h"

#include <cmath>

${cls}Processor::${cls}Processor()
    : soundor::AudioProcessor(BusesProperties()
        .withInput("Input", juce::AudioChannelSet::stereo(), true)
        .withOutput("Output", juce::AudioChannelSet::stereo(), true))
{
}

void ${cls}Processor::prepareToPlay(double sampleRate, int samplesPerBlock)
{
    juce::ignoreUnused(sampleRate, samplesPerBlock);
}

void ${cls}Processor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
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

juce::AudioProcessorEditor* ${cls}Processor::createEditor()
{
    return new ${cls}Editor(*this);
}

// Plugin entry point.
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new ${cls}Processor();
}
`;
}

function editorHeader(cls: string): string {
  return `#pragma once

#include <soundor/soundor.h>

#include "PluginProcessor.h"

// Your plugin's editor. Inherits soundor::AudioProcessorEditor (WebView +
// parameter bridge). Override onFrame() to stream app-specific telemetry.
class ${cls}Editor final : public soundor::AudioProcessorEditor
{
public:
    explicit ${cls}Editor(${cls}Processor&);
    ~${cls}Editor() override = default;

protected:
    void onFrame() override;

private:
    ${cls}Processor& processor;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(${cls}Editor)
};
`;
}

function editorSource(cls: string): string {
  return `#include "PluginEditor.h"

${cls}Editor::${cls}Editor(${cls}Processor& p)
    : soundor::AudioProcessorEditor(p), processor(p)
{
}

void ${cls}Editor::onFrame()
{
    // Push the audio level to the UI as a 'level' event (~60fps). Subscribe on
    // the UI with useEvent('level', ...) / useEventValue('level').
    emitEvent("level", juce::var(processor.getCurrentLevel()));
}
`;
}

/** A C++-safe class-name base derived from the plugin name. */
function cppClassBase(pluginName: string): string {
  const ident = pluginName.replace(/[^A-Za-z0-9_]/g, '');
  const safe = /^[A-Za-z_]/.test(ident) ? ident : `Plugin${ident}`;
  return safe.length > 0 ? safe : 'SoundorPlugin';
}

/** CMake project names can't contain spaces; collapse to an identifier. */
function cmakeProject(pluginName: string): string {
  const ident = pluginName.replace(/[^A-Za-z0-9_]/g, '');
  return ident.length > 0 ? ident : 'SoundorPlugin';
}

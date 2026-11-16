/**
 * Project scaffolding for the JUCE runtime's `init` phase — the **user-owned**
 * host, written once under `runtimes/<id>/` and never regenerated. The user has
 * full control here, including `CMakeLists.txt`; Soundor injects only a single
 * `include(...)` line pointing at the generated `setup.cmake`.
 *
 * The scaffolded classes inherit the generated `soundor::AudioProcessor` /
 * `soundor::AudioProcessorEditor` bases (which own the parameters, run the
 * Rust audio processing in `native/`, and host the plugin view). What is
 * neither config nor processing — the editor, a native API, buses when the
 * config declares no `audio` — lives in these files, not in `gen`.
 */

import type { ResolvedSoundorConfig } from '@soundor/runtime-sdk';

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
  config?: ResolvedSoundorConfig,
): ScaffoldFile[] {
  const dir = `runtimes/${runtimeId}`;
  const cls = cppClassBase(options.pluginName);
  const files = [
    {
      path: `${dir}/CMakeLists.txt`,
      contents: cmakeLists(options, includePath),
    },
    {
      path: `${dir}/PluginProcessor.h`,
      contents: processorHeader(
        cls,
        options.pluginName,
        config?.audio !== undefined,
      ),
    },
    {
      path: `${dir}/PluginProcessor.cpp`,
      contents: processorSource(cls, config?.audio !== undefined),
    },
    { path: `${dir}/PluginEditor.h`, contents: editorHeader(cls) },
    { path: `${dir}/PluginEditor.cpp`, contents: editorSource(cls) },
  ];
  if (config?.presets?.length) {
    const processor = files.find((file) =>
      file.path.endsWith('PluginProcessor.h'),
    )!;
    processor.contents = processor.contents.replace(
      /    int getNumPrograms\(\)[\s\S]*?    void changeProgramName[^\n]*\n/,
      '',
    );
  }
  return files;
}

function cmakeLists(options: ResolvedJuceOptions, includePath: string): string {
  return `cmake_minimum_required(VERSION 3.22)

project(${cmakeProject(options.pluginName)})

# Soundor injects only the generated JUCE setup below (plugin identity and
# formats, parameters, the Soundor base classes). Everything else in this file
# is yours to edit.
include(\${CMAKE_CURRENT_SOURCE_DIR}/${includePath})

target_sources(\${PROJECT_NAME}
    PRIVATE
        PluginEditor.cpp
        PluginProcessor.cpp)
`;
}

function processorHeader(
  cls: string,
  pluginName: string,
  configuredAudio: boolean,
): string {
  return `#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <soundor/soundor.h>

// Your plugin's processor. Inherits soundor::AudioProcessor, which owns the
// parameters generated from soundor.config and runs the Rust crate in
// native/: its audio processing, and its controller, which backs the native
// API's methods when it exports one. What is here is the rest of the plugin:
// its editor${configuredAudio ? '' : ', its buses'} and, for a native API in C++ instead,
// createNativeApi().
class ${cls}Processor final : public soundor::AudioProcessor
{
public:
    ${cls}Processor();
    ~${cls}Processor() override = default;
${configuredAudio ? '' : '\n    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;\n'}
    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return ${JSON.stringify(pluginName)}; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
${configuredAudio ? '' : '    double getTailLengthSeconds() const override { return 0.0; }\n'}
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

private:
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(${cls}Processor)
};
`;
}

function processorSource(cls: string, configuredAudio: boolean): string {
  const buses = configuredAudio
    ? `${cls}Processor::${cls}Processor() : soundor::AudioProcessor() {}
`
    : `${cls}Processor::${cls}Processor()
    : soundor::AudioProcessor(BusesProperties()
        .withInput("Input", juce::AudioChannelSet::stereo(), true)
        .withOutput("Output", juce::AudioChannelSet::stereo(), true))
{
}

bool ${cls}Processor::isBusesLayoutSupported(const BusesLayout& layouts) const
{
    // Standalone always runs stereo, but a DAW (e.g. Reaper) negotiates the bus
    // layout and, without this guard, JUCE would accept any arrangement — then
    // the processing could be handed a layout it doesn't handle (discrete,
    // in != out). Restrict to mono or stereo with the input matching the output.
    // Declare \`audio\` in soundor.config to have Soundor generate this.
    const auto& mainOutput = layouts.getMainOutputChannelSet();
    const auto& mainInput = layouts.getMainInputChannelSet();

    if (mainOutput != juce::AudioChannelSet::mono()
        && mainOutput != juce::AudioChannelSet::stereo())
        return false;

    return mainInput == mainOutput;
}
`;
  return `#include "PluginProcessor.h"
#include "PluginEditor.h"

${buses}
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

// Your plugin's editor. Inherits soundor::AudioProcessorEditor, the view the
// Soundor UI renders into.
class ${cls}Editor final : public soundor::AudioProcessorEditor
{
public:
    explicit ${cls}Editor(${cls}Processor&);
    ~${cls}Editor() override = default;

private:
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(${cls}Editor)
};
`;
}

function editorSource(cls: string): string {
  return `#include "PluginEditor.h"

${cls}Editor::${cls}Editor(${cls}Processor& p)
    : soundor::AudioProcessorEditor(p)
{
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

#pragma once

// The plugin, as its descriptor describes it (PluginAbi.h): parsed once per
// loaded module, read-only after, shared by every instance and thread.

#include "Expression.h"
#include "Json.h"

#include <soundor/parameters/Parameters.h>
#include <soundor/platform/Resources.h>
#include <soundor/processor/RustProcessor.h>

#include <array>
#include <cstdint>
#include <filesystem>
#include <map>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace soundor::vst3
{
    namespace parameters = soundor::parameters;

    // The version of the descriptor's JSON this adapter reads (descriptor.ts's DESCRIPTOR_FORMAT).
    inline constexpr int descriptorFormat = 1;

    using ClassId = std::array<std::uint8_t, 16>;

    struct Bus
    {
        std::string name;
        // The channels it starts with; 0 when it starts disabled (inactive).
        int initialChannels = 0;
        // The channels it has when the host enables it.
        int enabledChannels = 0;
    };

    // A combination of channel counts the plugin supports: for each bus, the
    // counts it may have (0: disabled).
    struct Layout
    {
        std::string name;
        std::vector<std::vector<int>> inputs, outputs;
    };

    struct ParameterBehavior
    {
        expression::Base valueType = expression::Base::Float64;
        expression::Expression toValue, toNormalized, constrain, format, parse;
    };

    struct Parameter
    {
        parameters::Info info;
        // Its VST3 ParamID (a hash of its id: stable across versions).
        std::uint32_t vstId = 0;
        // The VST3 unit of its group (0: the root).
        std::int32_t unit = 0;
        // VST3's step count: 0 continuous, else the number of steps.
        std::int32_t stepCount = 0;
        ParameterBehavior behavior;
    };

    struct Group
    {
        std::string id;
        std::string label;
        std::int32_t unit = 0;
    };

    struct EditorConfig
    {
        int width = 800;
        int height = 600;
        int minWidth = 0;
        int minHeight = 0;
        int maxWidth = 0; // 0: unbounded
        int maxHeight = 0;
        bool resizable = false;
        // Resizing zooms (the UI stays laid out at width×height) rather than laying out again.
        bool scale = false;
        bool keepAspectRatio = false;
        // 'cover' rather than 'contain'.
        bool cover = false;
        std::uint32_t background = 0xFF000000;
    };

    struct StateField
    {
        std::string name;
        json::Value type; // the descriptor's state type node
        std::string defaultJson; // canonical
        std::optional<std::size_t> maxLength;
        bool audio = false;
    };

    // A field of the audio state snapshot (describeAudioState()).
    struct AudioField
    {
        std::string name;
        bool array = false;
        std::string element; // "boolean", "int8" ... "float64"
        std::size_t offset = 0;
        std::size_t dataOffset = 0;
        std::size_t maxLength = 0;
    };

    struct Stream
    {
        std::string name;
        bool buffer = false;
        std::string element; // a buffer's element type
        std::size_t maxLength = 0;
    };

    struct Preset
    {
        std::string id;
        std::string name;
        // Plain values by parameter index (writable parameters only).
        std::vector<std::pair<std::size_t, double>> parameters;
        // Canonical JSON by state field name.
        std::map<std::string, std::string> state;
    };

    struct Plugin
    {
        std::string id;
        std::string name;
        std::string vendor;
        std::string url;
        std::string email;
        std::string version;
        std::string copyright;
        // VST3 subcategories ("Fx|Dynamics").
        std::string subcategories;
        ClassId processorCid {};
        ClassId controllerCid {};

        std::vector<Bus> inputs, outputs;
        std::vector<Layout> layouts;
        bool midiInput = false;
        bool midiOutput = false;
        std::uint32_t latency = 0;
        // Seconds; negative: dynamic, unknown here (reported as none).
        double tailSeconds = 0;

        EditorConfig editor;
        // How long one call into the UI's JavaScript may run, in ms (0: no limit).
        int timeLimit = 5000;
        std::vector<Parameter> parameters;
        std::vector<parameters::Info> infos; // parameters' infos, for parameters::Host
        std::vector<Group> groups;
        std::vector<StateField> state;
        json::Value stateTypes; // declared struct and enum types, by name
        std::vector<AudioField> audioState;
        std::size_t audioStateSize = 0;
        std::vector<Preset> presets;
        std::vector<Stream> streams;
        std::vector<std::string> events;
        processor::RustContract contract;

        std::vector<std::uint8_t> controllerDescriptor;
        // The UI: embedded files, or a development directory.
        std::vector<platform::EmbeddedFile> files;
        std::filesystem::path uiDirectory;
        std::filesystem::path logFile;

        // The parameter with VST3 id `id`, or null.
        [[nodiscard]] const Parameter* parameterById(std::uint32_t vstId) const noexcept;
        [[nodiscard]] std::optional<std::size_t> indexOf(std::uint32_t vstId) const noexcept;
        [[nodiscard]] std::optional<std::size_t> indexOf(std::string_view parameterId) const noexcept;

        // The parameter's behaviour on plain values (doubles: the number,
        // 0/1, the option index), as parameters::Host has it. The numeric
        // ones allocate nothing.
        [[nodiscard]] double toValue(std::size_t index, double normalized) const noexcept;
        [[nodiscard]] double toNormalized(std::size_t index, double plain) const noexcept;
        [[nodiscard]] double constrain(std::size_t index, double plain) const noexcept;
        [[nodiscard]] std::string format(std::size_t index, double plain) const;
        [[nodiscard]] std::optional<double> parse(std::size_t index, std::string_view text) const;

        std::map<std::uint32_t, std::size_t> byVstId;
    };

    // Parses a descriptor; throws json::Error saying what is wrong.
    [[nodiscard]] std::unique_ptr<Plugin> parseDescriptor(std::string_view json);

    // The module's plugin, from soundor_vst3_plugin() on first use; null
    // (and why, in `error`) when it cannot be read.
    [[nodiscard]] const Plugin* plugin(std::string* error = nullptr);

    // A ClassId from 32 hexadecimal digits.
    [[nodiscard]] ClassId parseClassId(std::string_view hex);
} // namespace soundor::vst3

#pragma once

// A plugin instance's saved state: the document the VST3 component writes in
// getState() (the host keeps it in its project) and reads back in setState(),
// and which the controller reads in setComponentState().
//
// The JUCE runtime's format (its getStateInformation()), so a snapshot means
// the same thing in every runtime:
//
//   {"version":1,"parameters":{"gain":0.5,"mode":"warm","on":true},"state":{...}}
//
// a boolean parameter as a boolean, a choice as its option's value, a number
// as a number; persistent state as its canonical values. Parameters and
// fields absent from a document take their defaults.

#include "Descriptor.h"
#include "State.h"

#include <map>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace soundor::vst3
{
    struct StateDocument
    {
        // Plain values, in the config's order.
        std::vector<double> parameters;
        // Canonical JSON by field name.
        std::map<std::string, std::string> state;
    };

    [[nodiscard]] std::string writeStateDocument(const Plugin& plugin, const StateSchema& schema,
                                                 std::span<const double> parameters,
                                                 const std::map<std::string, std::string>& state);
    // Throws std::invalid_argument saying what is wrong.
    [[nodiscard]] StateDocument readStateDocument(const Plugin& plugin, const StateSchema& schema,
                                                  std::string_view text);
    // The defaults: every parameter's and field's.
    [[nodiscard]] StateDocument defaultStateDocument(const Plugin& plugin, const StateSchema& schema);
} // namespace soundor::vst3

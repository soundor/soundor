#pragma once

// Factory presets (`soundor:presets`, and the host's program list): the
// descriptor's complete snapshots, loaded through the parameters' and the
// state's own editors (so a load is told to the host and recorded in
// History, as one entry when asked), with the selection a History field of
// its own, so undoing a load restores it too.

#include "Descriptor.h"
#include "ParameterHost.h"
#include "State.h"

#include <soundor/history/StateHistory.h>

#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace soundor::vst3
{
    class FactoryPresets
    {
    public:
        struct Selection
        {
            std::optional<std::string> factoryId;
            bool modified = false;
            bool operator==(const Selection&) const = default;
        };

        FactoryPresets(const Plugin& plugin, std::span<const std::unique_ptr<ParameterEditor>> editors,
                       StateStore& store, history::StateHistory& history);
        ~FactoryPresets();
        FactoryPresets(const FactoryPresets&) = delete;
        FactoryPresets& operator=(const FactoryPresets&) = delete;
        FactoryPresets(FactoryPresets&&) = delete;
        FactoryPresets& operator=(FactoryPresets&&) = delete;

        [[nodiscard]] const std::vector<Preset>& factoryPresets() const noexcept { return definition.presets; }
        // Throws std::invalid_argument for an unknown id.
        void loadFactory(std::string_view id, const history::Options& options = {});
        [[nodiscard]] Selection snapshot() const;
        // The index of the selected preset, for the host's program list, or -1.
        [[nodiscard]] int selectedIndex() const;
        [[nodiscard]] history::StateHistory& historyManager() { return manager; }
        // A restored project: no factory preset is selected.
        void restored();

    private:
        struct SelectionField;
        [[nodiscard]] bool matches(std::size_t index) const;

        const Plugin& definition;
        std::span<const std::unique_ptr<ParameterEditor>> parameters;
        StateStore& state;
        history::StateHistory& manager;
        std::unique_ptr<SelectionField> selection;
    };
} // namespace soundor::vst3

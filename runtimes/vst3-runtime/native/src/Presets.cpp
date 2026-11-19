#include "Presets.h"

#include <cmath>
#include <functional>
#include <stdexcept>
#include <utility>

namespace soundor::vst3
{
    // The selected factory preset's id ("" for none), as a History field.
    struct FactoryPresets::SelectionField final : history::Field
    {
        std::string current;
        std::function<void()> changed;

        SelectionField()
        {
            id = "preset:selection";
            label = "Preset";
        }

        [[nodiscard]] history::Value read() const override { return current; }

        std::unique_ptr<history::Prepared> prepare(const history::Value& value) override
        {
            struct Write final : history::Prepared
            {
                SelectionField& field;
                std::string next;
                Write(SelectionField& owner, std::string value) : field(owner), next(std::move(value)) {}
                void install() noexcept override { field.current.swap(next); }
                void notify() noexcept override
                {
                    if (field.changed)
                        field.changed();
                }
            };
            return std::make_unique<Write>(*this, std::get<std::string>(value));
        }
    };

    FactoryPresets::FactoryPresets(const Plugin& plugin, std::span<const std::unique_ptr<ParameterEditor>> editors,
                                   StateStore& store, history::StateHistory& history)
        : definition(plugin),
          parameters(editors),
          state(store),
          manager(history),
          selection(std::make_unique<SelectionField>())
    {
        manager.registerField(*selection);
    }

    FactoryPresets::~FactoryPresets() = default;

    void FactoryPresets::loadFactory(std::string_view id, const history::Options& options)
    {
        const Preset* preset = nullptr;
        for (const auto& candidate : definition.presets)
            if (candidate.id == id)
                preset = &candidate;
        if (preset == nullptr)
            throw std::invalid_argument("Unknown factory preset '" + std::string(id) + "'");
        const auto label = options.label.empty() ? "Load " + preset->name : options.label;
        const auto load = [&]
        {
            const history::Options inner;
            for (const auto& [index, plain] : preset->parameters)
                if (definition.parameters[index].info.access != parameters::Access::ReadOnly)
                    parameters[index]->set(plain, inner);
            for (const auto& [field, json] : preset->state)
                state.set(field, json, inner);
            manager.edit(selection->id, [&]() -> history::Value { return preset->id; }, inner);
        };
        // One snapshot, applied together: one History entry when recorded.
        if (manager.inTransaction())
            load();
        else
            manager.transaction(label, load, options.enabled);
    }

    bool FactoryPresets::matches(std::size_t index) const
    {
        const auto& preset = definition.presets[index];
        for (const auto& [parameter, plain] : preset.parameters)
        {
            if (definition.parameters[parameter].info.access == parameters::Access::ReadOnly)
                continue;
            const double current = parameters[parameter]->get();
            // Host automation carries 32-bit normalized values: a value that
            // round-trips through one is the preset's.
            if (current != plain && static_cast<float>(current) != static_cast<float>(plain))
                return false;
        }
        for (const auto& [field, json] : preset.state)
            if (state.get(field) != json)
                return false;
        return true;
    }

    FactoryPresets::Selection FactoryPresets::snapshot() const
    {
        const auto selected = std::get<std::string>(manager.read(selection->id));
        if (selected.empty())
            return {};
        for (std::size_t i = 0; i < definition.presets.size(); ++i)
            if (definition.presets[i].id == selected)
                return { selected, ! matches(i) };
        return {};
    }

    int FactoryPresets::selectedIndex() const
    {
        const auto selected = std::get<std::string>(manager.read(selection->id));
        for (std::size_t i = 0; i < definition.presets.size(); ++i)
            if (definition.presets[i].id == selected)
                return static_cast<int>(i);
        return -1;
    }

    void FactoryPresets::onSelected(std::function<void()> listener)
    {
        selection->changed = std::move(listener);
    }

    void FactoryPresets::restored()
    {
        selection->current.clear();
    }
} // namespace soundor::vst3

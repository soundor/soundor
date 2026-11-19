#include "ParameterHost.h"

#include <cmath>
#include <stdexcept>

namespace soundor::vst3
{
    ParameterEditor::ParameterEditor(const Plugin& plugin, std::size_t parameter, ParameterTarget& owner,
                                     history::StateHistory& history)
        : definition(plugin), index(parameter), target(owner), manager(history)
    {
        const auto& info = plugin.parameters.at(parameter).info;
        id = "parameter:" + info.id;
        label = info.label;
        manager.registerField(*this);
    }

    bool ParameterEditor::automatable() const
    {
        return definition.parameters[index].info.access == parameters::Access::Automatable;
    }

    bool ParameterEditor::readOnly() const
    {
        return definition.parameters[index].info.access == parameters::Access::ReadOnly;
    }

    history::Value ParameterEditor::read() const
    {
        return target.plain(index);
    }

    double ParameterEditor::get() const
    {
        return std::get<double>(manager.read(id));
    }

    void ParameterEditor::set(double value, const history::Options& options)
    {
        manager.edit(
            id,
            [&]() -> history::Value
            {
                if (readOnly() || ! std::isfinite(value))
                    throw std::invalid_argument("invalid or read-only parameter write");
                return definition.constrain(index, value);
            },
            options);
    }

    void ParameterEditor::beginGesture(const history::Options& options, Owner owner)
    {
        manager.guard(
            [&]
            {
                if (readOnly())
                    throw std::invalid_argument("read-only parameter gesture");
                if (options.enabled && manager.ownsGesture(id) && ! owners.contains(owner))
                    throw std::logic_error("field already belongs to another History gesture owner");
                auto [entry, inserted] = owners.try_emplace(owner, 0);
                try
                {
                    manager.beginGesture(id, options, owner);
                    if (total == 0 && automatable())
                        target.beginHostEdit(index);
                    ++entry->second;
                    ++total;
                }
                catch (...)
                {
                    if (inserted)
                        owners.erase(entry);
                    throw;
                }
            });
    }

    void ParameterEditor::endGesture(Owner owner)
    {
        manager.guard(
            [&]
            {
                if (manager.inTransaction())
                    throw std::logic_error("cannot end a gesture inside a transaction");
                const auto it = owners.find(owner);
                if (it == owners.end())
                    return;
                manager.endGesture(id);
                if (--it->second == 0)
                    owners.erase(it);
                if (--total == 0 && automatable())
                    target.endHostEdit(index);
            });
    }

    void ParameterEditor::disconnect(Owner owner) noexcept
    {
        const std::lock_guard lock(manager.mutex());
        const auto it = owners.find(owner);
        if (it == owners.end())
            return;
        manager.cancelGesture(id, it->second, owner);
        total -= it->second;
        owners.erase(it);
        if (total == 0 && automatable())
        {
            try
            {
                target.endHostEdit(index);
            }
            catch (...) // NOLINT(bugprone-empty-catch): host callbacks must not escape noexcept cleanup.
            {
            }
        }
    }

    std::unique_ptr<history::Prepared> ParameterEditor::prepare(const history::Value& value)
    {
        const auto number = std::get<double>(value);
        if (! std::isfinite(number) || readOnly())
            throw std::invalid_argument("invalid History parameter replay");
        struct Write final : history::Prepared
        {
            ParameterEditor& field;
            double next;
            Write(ParameterEditor& owner, double plain) : field(owner), next(plain) {}
            void install() noexcept override
            {
                try
                {
                    field.target.installPlain(field.index, next);
                }
                // Installing never throws in practice; History needs noexcept.
                catch (...) // NOLINT(bugprone-empty-catch)
                {
                }
            }
            void notify() noexcept override
            {
                // An edit outside a gesture gets one of its own, so the host
                // records it as automation.
                const bool automatic = field.total == 0 && field.automatable();
                try
                {
                    if (automatic)
                        field.target.beginHostEdit(field.index);
                    field.target.notifyPlain(field.index);
                    if (automatic)
                        field.target.endHostEdit(field.index);
                }
                catch (...) // NOLINT(bugprone-empty-catch): host callbacks must not escape noexcept cleanup.
                {
                }
            }
        };
        return std::make_unique<Write>(*this, definition.constrain(index, number));
    }

    // ── UiParameters ─────────────────────────────────────────────────────────

    UiParameters::UiParameters(const Plugin& plugin, std::span<const std::unique_ptr<ParameterEditor>> fields,
                               history::StateHistory& history)
        : definition(plugin), editors(fields), manager(history), flags(plugin.parameters.size())
    {
    }

    UiParameters::~UiParameters()
    {
        disconnectEdits();
    }

    ParameterEditor::Owner UiParameters::owner() const noexcept
    {
        return static_cast<ParameterEditor::Owner>(reinterpret_cast<std::uintptr_t>(this));
    }

    double UiParameters::value(std::size_t index) const
    {
        return editors[index]->get();
    }

    void UiParameters::setValue(std::size_t index, double value)
    {
        editors[index]->set(value);
    }

    void UiParameters::beginGesture(std::size_t index)
    {
        editors[index]->beginGesture({}, owner());
    }

    void UiParameters::endGesture(std::size_t index)
    {
        editors[index]->endGesture(owner());
    }

    void UiParameters::edit(std::size_t index, double value, const history::Options& options)
    {
        editors[index]->set(value, options);
    }

    void UiParameters::beginEdit(std::size_t index, const history::Options& options)
    {
        editors[index]->beginGesture(options, owner());
    }

    void UiParameters::endEdit(std::size_t index)
    {
        editors[index]->endGesture(owner());
    }

    void UiParameters::disconnectEdits() noexcept
    {
        for (const auto& editor : editors)
            editor->disconnect(owner());
    }

    double UiParameters::constrain(std::size_t index, double value) const
    {
        return definition.constrain(index, value);
    }

    double UiParameters::toNormalized(std::size_t index, double value) const
    {
        return definition.toNormalized(index, value);
    }

    double UiParameters::fromNormalized(std::size_t index, double normalized) const
    {
        return definition.toValue(index, normalized < 0 ? 0 : normalized > 1 ? 1 : normalized);
    }

    std::string UiParameters::format(std::size_t index, double value) const
    {
        return definition.format(index, value);
    }

    std::optional<double> UiParameters::parse(std::size_t index, std::string_view text) const
    {
        return definition.parse(index, text);
    }
} // namespace soundor::vst3

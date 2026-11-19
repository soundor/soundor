#pragma once

// Parameters on the controller's side: edits by the UI and the Rust
// controller go through History (ParameterEditor, the JUCE backend's, with
// VST3's beginEdit/performEdit/endEdit for the host), and the UI's
// `soundor:parameters` reads and writes them (UiParameters).
//
// Everything here runs on the controller's (UI) thread. The host's own
// changes (automation, a restored project) arrive through
// setParamNormalized() and never enter History.

#include "Descriptor.h"

#include <soundor/history/StateHistory.h>
#include <soundor/parameters/Parameters.h>

#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <span>
#include <string>

namespace soundor::vst3
{
    namespace history = soundor::history;

    // What the controller lends its parameters' editors.
    class ParameterTarget
    {
    public:
        virtual ~ParameterTarget() = default;
        // The current plain value.
        [[nodiscard]] virtual double plain(std::size_t index) const = 0;
        // Sets the value without telling anyone (History installs, then notifies).
        virtual void installPlain(std::size_t index, double plain) = 0;
        // Tells the host (performEdit) and the UI of the value installed.
        virtual void notifyPlain(std::size_t index) = 0;
        virtual void beginHostEdit(std::size_t index) = 0;
        virtual void endHostEdit(std::size_t index) = 0;
    };

    class ParameterEditor final : public history::Field
    {
    public:
        using Owner = std::uint64_t;

        ParameterEditor(const Plugin& plugin, std::size_t parameter, ParameterTarget& owner,
                        history::StateHistory& history);
        ~ParameterEditor() override = default;
        ParameterEditor(const ParameterEditor&) = delete;
        ParameterEditor& operator=(const ParameterEditor&) = delete;
        ParameterEditor(ParameterEditor&&) = delete;
        ParameterEditor& operator=(ParameterEditor&&) = delete;

        [[nodiscard]] history::Value read() const override;
        std::unique_ptr<history::Prepared> prepare(const history::Value& value) override;

        // The value as History sees it (staged inside a transaction).
        [[nodiscard]] double get() const;
        void set(double value, const history::Options& options = {});
        void beginGesture(const history::Options& options = {}, Owner owner = 0);
        void endGesture(Owner owner = 0);
        void disconnect(Owner owner) noexcept;

    private:
        [[nodiscard]] bool automatable() const;
        [[nodiscard]] bool readOnly() const;

        const Plugin& definition;
        std::size_t index;
        ParameterTarget& target;
        history::StateHistory& manager;
        std::map<Owner, std::size_t> owners;
        std::size_t total = 0;
    };

    // `soundor:parameters` for one editor's runtime.
    class UiParameters final : public parameters::Host
    {
    public:
        UiParameters(const Plugin& plugin, std::span<const std::unique_ptr<ParameterEditor>> fields,
                     history::StateHistory& history);
        ~UiParameters() override;
        UiParameters(const UiParameters&) = delete;
        UiParameters& operator=(const UiParameters&) = delete;
        UiParameters(UiParameters&&) = delete;
        UiParameters& operator=(UiParameters&&) = delete;

        [[nodiscard]] std::span<const parameters::Info> infos() const override { return definition.infos; }
        [[nodiscard]] double value(std::size_t index) const override;
        void setValue(std::size_t index, double value) override;
        void beginGesture(std::size_t index) override;
        void endGesture(std::size_t index) override;
        [[nodiscard]] parameters::ChangeFlags& changes() override { return flags; }
        history::StateHistory* historyManager() override { return &manager; }
        void edit(std::size_t index, double value, const history::Options& options) override;
        void beginEdit(std::size_t index, const history::Options& options) override;
        void endEdit(std::size_t index) override;
        void disconnectEdits() noexcept override;

        [[nodiscard]] double constrain(std::size_t index, double value) const override;
        [[nodiscard]] double toNormalized(std::size_t index, double value) const override;
        [[nodiscard]] double fromNormalized(std::size_t index, double normalized) const override;
        [[nodiscard]] std::string format(std::size_t index, double value) const override;
        [[nodiscard]] std::optional<double> parse(std::size_t index, std::string_view text) const override;

    private:
        [[nodiscard]] ParameterEditor::Owner owner() const noexcept;

        const Plugin& definition;
        std::span<const std::unique_ptr<ParameterEditor>> editors;
        history::StateHistory& manager;
        parameters::ChangeFlags flags;
    };
} // namespace soundor::vst3
